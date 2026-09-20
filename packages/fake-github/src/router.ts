import { UnknownObjectError, type GitIdentity } from './objects.js';
import { FakeRepo, RefConflictError } from './repo.js';

/** One request the fake served, for assertions ("no stray calls") and for debugging. */
export interface ServedRequest {
  method: string;
  path: string;
  status: number;
}

/**
 * A scripted failure: the next `times` requests matching `match` are answered with
 * `status` + `message` instead of being routed. This is how a test or a virtual-user
 * scenario stages the failures the editor must cope with — a 401 mid-save, a 5xx on
 * publish, a 404 when a token lacks write scope — without touching the fake's state.
 */
export interface Fault {
  match: (req: { method: string; path: string }) => boolean;
  status: number;
  message?: string;
  /** How many matching requests to fail. Default 1. */
  times?: number;
}

export interface FakeGitHubOptions {
  /** The API origin to accept requests for. Default `https://api.github.com`. */
  apiOrigin?: string;
  /** Clock source shared by commit timestamps and Actions progress. Default `Date.now`. */
  now?: () => number;
}

interface Route {
  method: string;
  pattern: RegExp;
  handle: (ctx: RouteContext) => Promise<Response> | Response;
}

interface RouteContext {
  params: string[];
  url: URL;
  request: Request;
  login: string;
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-allow-headers':
    'authorization, content-type, accept, user-agent, x-github-api-version, cache-control, pragma',
  'access-control-expose-headers': 'link, x-ratelimit-remaining, x-github-request-id',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-github-request-id': 'FAKE',
      ...CORS_HEADERS,
    },
  });
}

function error(status: number, message: string): Response {
  return json(status, { message, documentation_url: 'https://docs.github.com/rest' });
}

/** GitHub wraps base64 blob content at 60 columns; the client strips the newlines. */
function base64Wrapped(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/(.{60})/g, '$1\n');
}

function base64Bytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/\s/g, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * The fake GitHub: a set of repos and users behind a `fetch`-compatible function that
 * speaks the REST subset `@timber/github`'s `RepoClient` uses (19 endpoints: the Git Data
 * API, repo metadata, branches, contents, compare, the authenticated user, and Actions
 * runs/jobs/dispatch). Hand `fetch` to the client as `fetchImpl` for an in-process test,
 * or route a browser's requests through it (see `./playwright`) to run the whole editor
 * against it.
 *
 * Everything unknown is a 404 recorded in `unhandled`, so a test can prove the client
 * asked for nothing the fake doesn't model — the cue to extend it, not to ignore it.
 */
export class FakeGitHub {
  readonly repos = new Map<string, FakeRepo>();
  /** token → login. A request whose bearer token isn't here gets GitHub's 401. */
  readonly tokens = new Map<string, string>();
  readonly served: ServedRequest[] = [];
  readonly unhandled: ServedRequest[] = [];
  readonly faults: Fault[] = [];
  /** Hooks run before routing; a harness uses one to stage a foreign push mid-flight. */
  readonly onRequest: ((req: {
    method: string;
    path: string;
  }) => void | Promise<void>)[] = [];
  readonly apiOrigin: string;
  readonly now: () => number;
  private readonly routes: Route[];

  constructor(options: FakeGitHubOptions = {}) {
    this.apiOrigin = options.apiOrigin ?? 'https://api.github.com';
    this.now = options.now ?? (() => Date.now());
    this.routes = this.buildRoutes();
    this.fetch = this.fetch.bind(this);
  }

  // --- setup -----------------------------------------------------------------

  addUser(login: string, token: string): void {
    this.tokens.set(token, login);
  }

  addRepo(options: ConstructorParameters<typeof FakeRepo>[0]): FakeRepo {
    const repo = new FakeRepo({
      ...options,
      actions: { now: this.now, ...options.actions },
    });
    this.repos.set(repo.fullName.toLowerCase(), repo);
    return repo;
  }

  repo(owner: string, name: string): FakeRepo | undefined {
    return this.repos.get(`${owner}/${name}`.toLowerCase());
  }

  /** Fail the next request(s) matching a method + path regexp. Returns the fault for later removal. */
  failNext(
    method: string,
    path: RegExp,
    status: number,
    message?: string,
    times = 1,
  ): Fault {
    const fault: Fault = {
      match: (req) => req.method === method && path.test(req.path),
      status,
      ...(message !== undefined ? { message } : {}),
      times,
    };
    this.faults.push(fault);
    return fault;
  }

  // --- the fetch surface -------------------------------------------------------

  /** A drop-in `fetch`. Bound in the constructor so it can be passed around bare. */
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    return this.handle(request);
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    // Octokit percent-encodes path parameters (`git/ref/heads%2Fmain`); match, log and
    // fault on the decoded form so a test can write the path the way GitHub documents it.
    const path = decodeURIComponent(url.pathname);
    const record = (status: number) => this.served.push({ method, path, status });

    if (method === 'OPTIONS') {
      record(204);
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (url.origin !== this.apiOrigin) {
      record(404);
      this.unhandled.push({ method, path: url.href, status: 404 });
      return error(404, `Not Found (the fake only serves ${this.apiOrigin})`);
    }

    for (const hook of this.onRequest) await hook({ method, path });

    const fault = this.faults.find(
      (f) => (f.times ?? 1) > 0 && f.match({ method, path }),
    );
    if (fault) {
      fault.times = (fault.times ?? 1) - 1;
      record(fault.status);
      return error(fault.status, fault.message ?? `Injected ${fault.status}`);
    }

    const login = this.authenticate(request);
    if (!login) {
      record(401);
      return error(401, 'Bad credentials');
    }

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(path);
      if (!m) continue;
      try {
        const response = await route.handle({ params: m.slice(1), url, request, login });
        record(response.status);
        return response;
      } catch (err) {
        if (err instanceof RefConflictError || err instanceof UnknownObjectError) {
          record(422);
          return error(422, err.message);
        }
        if (err instanceof NotFound) {
          record(404);
          return error(404, err.message);
        }
        throw err;
      }
    }

    record(404);
    this.unhandled.push({ method, path, status: 404 });
    return error(404, 'Not Found');
  }

  private authenticate(request: Request): string | undefined {
    const header = request.headers.get('authorization') ?? '';
    const token = header.replace(/^(bearer|token)\s+/i, '').trim();
    return token ? this.tokens.get(token) : undefined;
  }

  // --- routes ------------------------------------------------------------------

  private repoOr404(owner: string, name: string): FakeRepo {
    const repo = this.repo(owner, name);
    if (!repo) throw new NotFound('Not Found');
    return repo;
  }

  private identity(login: string): GitIdentity {
    return {
      name: login,
      email: `${login}@users.noreply.github.com`,
      date: new Date(this.now()).toISOString(),
    };
  }

  private buildRoutes(): Route[] {
    const R = '/repos/([^/]+)/([^/]+)';
    const sha = '([0-9a-f]{4,40})';
    const body = async <T>(request: Request): Promise<T> => (await request.json()) as T;

    return [
      {
        method: 'GET',
        pattern: /^\/user$/,
        handle: ({ login }) =>
          json(200, {
            login,
            id: 1,
            type: 'User',
            html_url: `https://github.com/${login}`,
          }),
      },
      {
        method: 'GET',
        pattern: new RegExp(`^${R}$`),
        handle: ({ params: [o, r] }) => {
          const repo = this.repoOr404(o!, r!);
          return json(200, {
            id: 1,
            name: repo.name,
            full_name: repo.fullName,
            owner: { login: repo.owner },
            private: repo.private,
            visibility: repo.private ? 'private' : 'public',
            default_branch: repo.defaultBranch,
            html_url: `https://github.com/${repo.fullName}`,
          });
        },
      },
      {
        method: 'GET',
        pattern: new RegExp(`^${R}/branches$`),
        handle: ({ params: [o, r] }) =>
          json(
            200,
            this.repoOr404(o!, r!)
              .listBranches()
              .map((b) => ({ name: b.name, commit: { sha: b.sha }, protected: false })),
          ),
      },
      {
        method: 'GET',
        pattern: new RegExp(`^${R}/git/ref/(.+)$`),
        handle: ({ params: [o, r, ref] }) => {
          const repo = this.repoOr404(o!, r!);
          const tip = repo.getRef(ref!);
          if (!tip) throw new NotFound('Not Found');
          return json(200, {
            ref: FakeRepo.refName(ref!),
            object: { type: 'commit', sha: tip },
          });
        },
      },
      {
        method: 'POST',
        pattern: new RegExp(`^${R}/git/refs$`),
        handle: async ({ params: [o, r], request }) => {
          const repo = this.repoOr404(o!, r!);
          const input = await body<{ ref: string; sha: string }>(request);
          repo.createRef(input.ref, input.sha);
          return json(201, {
            ref: FakeRepo.refName(input.ref),
            object: { type: 'commit', sha: input.sha },
          });
        },
      },
      {
        method: 'PATCH',
        pattern: new RegExp(`^${R}/git/refs/(.+)$`),
        handle: async ({ params: [o, r, ref], request }) => {
          const repo = this.repoOr404(o!, r!);
          const input = await body<{ sha: string; force?: boolean }>(request);
          repo.updateRef(ref!, input.sha, input.force ?? false);
          return json(200, {
            ref: FakeRepo.refName(ref!),
            object: { type: 'commit', sha: input.sha },
          });
        },
      },
      {
        method: 'GET',
        pattern: new RegExp(`^${R}/git/commits/${sha}$`),
        handle: ({ params: [o, r, s] }) => {
          const commit = this.repoOr404(o!, r!).store.getCommit(s!);
          if (!commit) throw new NotFound('Not Found');
          return json(200, {
            sha: commit.sha,
            message: commit.message,
            tree: { sha: commit.tree },
            parents: commit.parents.map((p) => ({ sha: p })),
            author: commit.author,
            committer: commit.committer,
          });
        },
      },
      {
        method: 'POST',
        pattern: new RegExp(`^${R}/git/commits$`),
        handle: async ({ params: [o, r], request, login }) => {
          const repo = this.repoOr404(o!, r!);
          const input = await body<{ message: string; tree: string; parents?: string[] }>(
            request,
          );
          const commit = await repo.store.putCommit({
            tree: input.tree,
            parents: input.parents ?? [],
            message: input.message,
            author: this.identity(login),
          });
          return json(201, {
            sha: commit.sha,
            message: commit.message,
            tree: { sha: commit.tree },
            parents: commit.parents.map((p) => ({ sha: p })),
          });
        },
      },
      {
        method: 'GET',
        pattern: new RegExp(`^${R}/git/trees/${sha}$`),
        handle: ({ params: [o, r, s], url }) => {
          const store = this.repoOr404(o!, r!).store;
          if (!store.getTree(s!)) throw new NotFound('Not Found');
          const recursive = url.searchParams.has('recursive');
          const entries = recursive
            ? store.flattenTree(s!)
            : store
                .getTree(s!)!
                .entries.map((e) => ({
                  path: e.name,
                  mode: e.mode,
                  type: e.type,
                  sha: e.sha,
                }));
          return json(200, { sha: s, truncated: false, tree: entries });
        },
      },
      {
        method: 'POST',
        pattern: new RegExp(`^${R}/git/trees$`),
        handle: async ({ params: [o, r], request }) => {
          const store = this.repoOr404(o!, r!).store;
          const input = await body<{
            base_tree?: string;
            tree: {
              path: string;
              mode?: string;
              type?: string;
              sha?: string | null;
              content?: string;
            }[];
          }>(request);
          if (input.base_tree && !store.getTree(input.base_tree))
            throw new UnknownObjectError('Base tree does not exist');
          const overlays = await Promise.all(
            input.tree.map(async (e) => {
              if (e.content !== undefined) {
                // Inline content is legal on GitHub; the client never uses it but a fake
                // that silently mis-hashed it would be worse than one that supports it.
                return {
                  path: e.path,
                  ...(e.mode ? { mode: e.mode } : {}),
                  sha: await store.putBlob(new TextEncoder().encode(e.content)),
                };
              }
              return {
                path: e.path,
                ...(e.mode ? { mode: e.mode } : {}),
                sha: e.sha ?? null,
              };
            }),
          );
          const treeSha = await store.overlayTree(input.base_tree, overlays);
          return json(201, {
            sha: treeSha,
            truncated: false,
            tree: store.flattenTree(treeSha),
          });
        },
      },
      {
        method: 'GET',
        pattern: new RegExp(`^${R}/git/blobs/${sha}$`),
        handle: ({ params: [o, r, s] }) => {
          const bytes = this.repoOr404(o!, r!).store.getBlob(s!);
          if (!bytes) throw new NotFound('Not Found');
          return json(200, {
            sha: s,
            size: bytes.length,
            encoding: 'base64',
            content: base64Wrapped(bytes),
          });
        },
      },
      {
        method: 'POST',
        pattern: new RegExp(`^${R}/git/blobs$`),
        handle: async ({ params: [o, r], request }) => {
          const store = this.repoOr404(o!, r!).store;
          const input = await body<{ content: string; encoding?: string }>(request);
          const bytes =
            input.encoding === 'base64'
              ? base64Bytes(input.content)
              : new TextEncoder().encode(input.content);
          return json(201, { sha: await store.putBlob(bytes) });
        },
      },
      {
        method: 'GET',
        pattern: new RegExp(`^${R}/contents/(.+)$`),
        handle: ({ params: [o, r, path], url }) => {
          const repo = this.repoOr404(o!, r!);
          const ref = url.searchParams.get('ref') ?? repo.defaultBranch;
          const commitSha = repo.getRef(ref) ?? ref;
          const commit = repo.store.getCommit(commitSha);
          if (!commit) throw new NotFound('Not Found');
          const blob = repo.store.blobsOf(commit.tree).get(path!);
          if (!blob) throw new NotFound('Not Found');
          const bytes = repo.store.getBlob(blob.sha)!;
          return json(200, {
            type: 'file',
            encoding: 'base64',
            size: bytes.length,
            name: path!.split('/').pop(),
            path,
            sha: blob.sha,
            content: base64Wrapped(bytes),
          });
        },
      },
      {
        method: 'GET',
        pattern: new RegExp(`^${R}/compare/(.+)$`),
        handle: ({ params: [o, r, basehead] }) => {
          const repo = this.repoOr404(o!, r!);
          const [baseRef, headRef] = basehead!.split('...');
          if (baseRef === undefined || headRef === undefined)
            throw new NotFound('Not Found');
          const resolve = (ref: string) =>
            repo.getRef(ref) ?? (repo.store.hasCommit(ref) ? ref : undefined);
          const base = resolve(baseRef);
          const head = resolve(headRef);
          if (!base || !head) throw new NotFound('Not Found');
          const mergeBase = repo.store.mergeBase(base, head);
          const aheadBy = repo.store.countAhead(base, head);
          const behindBy = repo.store.countAhead(head, base);
          const status =
            aheadBy === 0 && behindBy === 0
              ? 'identical'
              : aheadBy > 0 && behindBy > 0
                ? 'diverged'
                : aheadBy > 0
                  ? 'ahead'
                  : 'behind';
          // Three-dot compare diffs merge-base → head (what `git diff base...head` shows).
          const files = mergeBase
            ? repo.store.diffTrees(
                repo.store.getCommit(mergeBase)!.tree,
                repo.store.getCommit(head)!.tree,
              )
            : [];
          return json(200, {
            status,
            ahead_by: aheadBy,
            behind_by: behindBy,
            total_commits: aheadBy,
            base_commit: { sha: base },
            merge_base_commit: mergeBase ? { sha: mergeBase } : null,
            commits: [],
            files,
          });
        },
      },
      {
        method: 'GET',
        pattern: new RegExp(`^${R}/actions/workflows/([^/]+)/runs$`),
        handle: ({ params: [o, r, workflow], url }) => {
          const repo = this.repoOr404(o!, r!);
          const perPage = Number(url.searchParams.get('per_page') ?? 30);
          const runs = repo.actions
            .list({
              workflowFile: workflow!,
              ...(url.searchParams.get('branch')
                ? { branch: url.searchParams.get('branch')! }
                : {}),
              ...(url.searchParams.get('status')
                ? { status: url.searchParams.get('status')! }
                : {}),
            })
            .slice(0, perPage);
          return json(200, {
            total_count: runs.length,
            workflow_runs: runs.map((run) => repo.actions.toApi(run)),
          });
        },
      },
      {
        method: 'POST',
        pattern: new RegExp(`^${R}/actions/workflows/([^/]+)/dispatches$`),
        handle: async ({ params: [o, r, workflow], request }) => {
          const repo = this.repoOr404(o!, r!);
          const input = await body<{ ref: string }>(request);
          repo.dispatchWorkflow(workflow!, input.ref);
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        },
      },
      {
        method: 'GET',
        pattern: new RegExp(`^${R}/actions/runs/(\\d+)/jobs$`),
        handle: ({ params: [o, r, id] }) => {
          const repo = this.repoOr404(o!, r!);
          const run = repo.actions.get(Number(id));
          if (!run) throw new NotFound('Not Found');
          const jobs = repo.actions.jobsOf(run);
          return json(200, { total_count: jobs.length, jobs });
        },
      },
    ];
  }
}

class NotFound extends Error {}
