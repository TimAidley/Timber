import { describe, expect, it } from 'vitest';
import { GitLabClient, type FetchLike } from '../src/index.js';
import { utf8ToBase64 } from '../src/base64.js';

const BASE = 'https://gitlab.example';
const API = `${BASE}/api/v4`;
const P = '/projects/jane%2Fsite'; // URL-encoded project path

interface RecordedRequest {
  method: string;
  path: string; // path after /api/v4, query stripped
  query: URLSearchParams;
  body?: unknown;
}

interface RouteResult {
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
}
type Routes = Record<string, (req: RecordedRequest) => RouteResult>;

function fakeFetch(routes: Routes): { fetchImpl: FetchLike; log: RecordedRequest[] } {
  const log: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const rel = url.startsWith(API) ? url.slice(API.length) : url;
    const [path, qs = ''] = rel.split('?');
    const req: RecordedRequest = {
      method,
      path: path!,
      query: new URLSearchParams(qs),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    log.push(req);
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response('not found', { status: 404 });
    const { status = 200, json, headers } = handler(req);
    return new Response(json === undefined ? '' : JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  };
  return { fetchImpl, log };
}

function client(
  routes: Routes,
  projectPath?: string,
): { c: GitLabClient; log: RecordedRequest[] } {
  const { fetchImpl, log } = fakeFetch(routes);
  const c = new GitLabClient({
    apiBaseUrl: BASE,
    owner: 'jane',
    repo: 'site',
    getToken: async () => 'TOKEN',
    fetchImpl,
    ...(projectPath ? { projectPath } : {}),
  });
  return { c, log };
}

describe('GitLabClient — reads & addressing', () => {
  it('addresses the project by URL-encoded path and reads default branch + visibility', async () => {
    const { c, log } = client({
      [`GET ${P}`]: () => ({ json: { default_branch: 'main', visibility: 'internal' } }),
    });
    expect(await c.getDefaultBranch()).toBe('main');
    expect(await c.getVisibility()).toBe('private'); // internal -> private (not world-public)
    expect(log[0]!.path).toBe('/projects/jane%2Fsite');
  });

  it('supports an explicit projectPath for nested groups', async () => {
    const { c, log } = client(
      {
        ['GET /projects/grp%2Fsub%2Fsite']: () => ({ json: { default_branch: 'main' } }),
      },
      'grp/sub/site',
    );
    expect(await c.getDefaultBranch()).toBe('main');
    expect(log[0]!.path).toBe('/projects/grp%2Fsub%2Fsite');
  });

  it('getBranchSha returns the tip, or undefined on 404', async () => {
    const { c } = client({
      [`GET ${P}/repository/branches/main`]: () => ({
        json: { commit: { id: 'MAINSHA' } },
      }),
      [`GET ${P}/repository/branches/nope`]: () => ({ status: 404 }),
    });
    expect(await c.getBranchSha('main')).toBe('MAINSHA');
    expect(await c.getBranchSha('nope')).toBeUndefined();
  });

  it('loadTree follows x-next-page pagination and keeps blob+tree entries', async () => {
    const { c } = client({
      [`GET ${P}/repository/branches/main`]: () => ({ json: { commit: { id: 'C1' } } }),
      [`GET ${P}/repository/tree`]: (req) => {
        const page = req.query.get('page');
        if (page === '1') {
          return {
            json: [
              { id: 'B1', type: 'blob', path: 'content/pages/home/index.md' },
              { id: 'T1', type: 'tree', path: 'content/pages/home' },
            ],
            headers: { 'x-next-page': '2' },
          };
        }
        return {
          json: [{ id: 'B2', type: 'blob', path: 'config/schemas/pages.yml' }],
          headers: { 'x-next-page': '' },
        };
      },
    });
    const tree = await c.loadTree('main');
    expect(tree.commitSha).toBe('C1');
    expect(tree.entries.map((e) => e.path)).toEqual([
      'content/pages/home/index.md',
      'content/pages/home',
      'config/schemas/pages.yml',
    ]);
  });
});

// A small repo on `main`: index.md (B_INDEX -> "BODY"), a schema (B_SCHEMA), one page.
function singleTreeRepo(): Routes {
  return {
    [`GET ${P}`]: () => ({ json: { default_branch: 'main', visibility: 'private' } }),
    [`GET ${P}/repository/branches/main`]: () => ({ json: { commit: { id: 'C1' } } }),
    [`GET ${P}/repository/tree`]: () => ({
      json: [
        { id: 'B_INDEX', type: 'blob', path: 'content/pages/home/index.md' },
        { id: 'B_SCHEMA', type: 'blob', path: 'config/schemas/pages.yml' },
      ],
      headers: { 'x-next-page': '' },
    }),
    [`GET ${P}/repository/blobs/B_INDEX`]: () => ({
      json: { content: utf8ToBase64('BODY') },
    }),
    [`GET ${P}/repository/blobs/B_SCHEMA`]: () => ({
      json: { content: utf8ToBase64('SCHEMA') },
    }),
    [`POST ${P}/repository/commits`]: () => ({ json: { id: 'NEWCOMMIT' } }),
  };
}

describe('GitLabClient — commitFiles maps to the Commits API', () => {
  it('classifies create vs update, deletes, and uses a NATIVE move (no re-upload)', async () => {
    const { c, log } = client(singleTreeRepo());
    await c.commitFiles({
      branch: 'main',
      message: 'edit',
      files: [
        { path: 'content/pages/home/index.md', content: 'NEW' }, // exists -> update
        { path: 'content/pages/new/index.md', content: 'FRESH' }, // absent -> create
      ],
      deletions: ['config/schemas/pages.yml'],
      moves: [
        {
          from: 'content/pages/home/a.webp',
          to: 'content/pages/home/b.webp',
          sha: 'IGNORED',
        },
      ],
    });
    const post = log.find(
      (r) => r.method === 'POST' && r.path === `${P}/repository/commits`,
    )!;
    const body = post.body as {
      branch: string;
      start_branch?: string;
      actions: unknown[];
    };
    expect(body.branch).toBe('main');
    expect(body.start_branch).toBeUndefined();
    expect(body.actions).toEqual([
      {
        action: 'update',
        file_path: 'content/pages/home/index.md',
        content: utf8ToBase64('NEW'),
        encoding: 'base64',
      },
      {
        action: 'create',
        file_path: 'content/pages/new/index.md',
        content: utf8ToBase64('FRESH'),
        encoding: 'base64',
      },
      { action: 'delete', file_path: 'config/schemas/pages.yml' },
      // Native server-side move — no readBinaryBlob, no content.
      {
        action: 'move',
        previous_path: 'content/pages/home/a.webp',
        file_path: 'content/pages/home/b.webp',
      },
    ]);
  });

  it('creates a missing branch from the base via start_branch', async () => {
    const routes = singleTreeRepo();
    routes[`GET ${P}/repository/branches/jane_wip`] = () => ({ status: 404 });
    const { c, log } = client(routes);
    await c.commitFiles({
      branch: 'jane_wip',
      baseBranch: 'main',
      message: 'first',
      files: [{ path: 'content/pages/new/index.md', content: 'X' }],
    });
    const body = log.find((r) => r.method === 'POST')!.body as {
      branch: string;
      start_branch?: string;
    };
    expect(body.branch).toBe('jane_wip');
    expect(body.start_branch).toBe('main');
  });
});

describe('GitLabClient — compareChangedPaths uses the Compare API (rename-aware)', () => {
  it('maps new/deleted/renamed/modified with previousPath on renames', async () => {
    const { c } = client({
      [`GET ${P}/repository/compare`]: () => ({
        json: {
          diffs: [
            { new_path: 'a.md', old_path: 'a.md', new_file: true },
            { new_path: 'b.md', old_path: 'b.md', deleted_file: true },
            { new_path: 'c.md', old_path: 'was-c.md', renamed_file: true },
            { new_path: 'd.md', old_path: 'd.md' },
          ],
        },
      }),
    });
    expect(await c.compareChangedPaths('main', 'jane_wip')).toEqual([
      { path: 'a.md', status: 'added' },
      { path: 'b.md', status: 'removed' },
      { path: 'c.md', status: 'renamed', previousPath: 'was-c.md' },
      { path: 'd.md', status: 'modified' },
    ]);
  });
});

describe('GitLabClient — resetBranch deletes then recreates the branch', () => {
  it('DELETEs the WIP branch and POSTs it back at the target sha', async () => {
    const { c, log } = client({
      [`DELETE ${P}/repository/branches/jane_wip`]: () => ({ json: {} }),
      [`POST ${P}/repository/branches`]: () => ({ json: {} }),
    });
    await c.resetBranch('jane_wip', 'NEWMAIN');
    const del = log.find((r) => r.method === 'DELETE')!;
    expect(del.path).toBe(`${P}/repository/branches/jane_wip`);
    const post = log.find((r) => r.method === 'POST')!;
    expect(post.query.get('branch')).toBe('jane_wip');
    expect(post.query.get('ref')).toBe('NEWMAIN');
  });
});

describe('GitLabClient — publishSquash replays onto main then resets WIP', () => {
  it('applies WIP changes as one commit and recreates WIP at the new sha', async () => {
    const { c, log } = client({
      [`GET ${P}/repository/branches/main`]: () => ({ json: { commit: { id: 'MAIN' } } }),
      [`GET ${P}/repository/tree`]: () => ({
        json: [{ id: 'OLD', type: 'blob', path: 'content/pages/home/index.md' }],
        headers: { 'x-next-page': '' },
      }),
      [`GET ${P}/repository/files/content%2Fpages%2Fhome%2Findex.md`]: () => ({
        json: { content: utf8ToBase64('WIP BODY') },
      }),
      [`POST ${P}/repository/commits`]: () => ({ json: { id: 'NEWMAIN' } }),
      [`DELETE ${P}/repository/branches/jane_wip`]: () => ({ json: {} }),
      [`POST ${P}/repository/branches`]: () => ({ json: {} }),
    });
    const res = await c.publishSquash({
      defaultBranch: 'main',
      wipBranch: 'jane_wip',
      parentSha: 'MAIN',
      wipTip: 'WIP',
      message: 'Publish',
      strategy: 'clean',
      changes: [{ path: 'content/pages/home/index.md', status: 'modified' }],
    });
    expect(res.sha).toBe('NEWMAIN');
    const commit = log.find(
      (r) => r.method === 'POST' && r.path === `${P}/repository/commits`,
    )!;
    expect((commit.body as { actions: unknown[] }).actions).toEqual([
      {
        action: 'update',
        file_path: 'content/pages/home/index.md',
        content: utf8ToBase64('WIP BODY'),
        encoding: 'base64',
      },
    ]);
    // WIP reset via delete + recreate at the new main sha.
    expect(
      log.some(
        (r) => r.method === 'DELETE' && r.path === `${P}/repository/branches/jane_wip`,
      ),
    ).toBe(true);
    const recreate = log.find(
      (r) => r.method === 'POST' && r.path === `${P}/repository/branches`,
    )!;
    expect(recreate.query.get('ref')).toBe('NEWMAIN');
  });
});

describe('GitLabClient — DeployBackend over CI/CD pipelines', () => {
  it('maps the latest pipeline status onto a DeployRun', async () => {
    const mk = (status: string) =>
      client({
        [`GET ${P}/pipelines`]: () => ({
          json: [
            {
              status,
              web_url: 'https://gitlab.example/jane/site/-/pipelines/9',
              ref: 'main',
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
        }),
      }).c;

    expect(await mk('success').deploy!.getLatestDeploy('main')).toMatchObject({
      status: 'completed',
      conclusion: 'success',
    });
    expect(await mk('failed').deploy!.getLatestDeploy('main')).toMatchObject({
      status: 'completed',
      conclusion: 'failure',
    });
    expect(await mk('running').deploy!.getLatestDeploy('main')).toMatchObject({
      status: 'in_progress',
      conclusion: null,
    });

    const none = client({ [`GET ${P}/pipelines`]: () => ({ json: [] }) }).c;
    expect(await none.deploy!.getLatestDeploy('main')).toBeUndefined();
  });

  it('triggerDeploy creates a pipeline on the ref', async () => {
    const { c, log } = client({ [`POST ${P}/pipeline`]: () => ({ json: { id: 1 } }) });
    await c.deploy!.triggerDeploy('main');
    const post = log.find((r) => r.method === 'POST')!;
    expect(post.path).toBe(`${P}/pipeline`);
    expect(post.body).toEqual({ ref: 'main' });
  });
});
