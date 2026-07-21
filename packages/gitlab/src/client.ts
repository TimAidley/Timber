import type {
  ChangedPath,
  CommitFilesInput,
  CommitResult,
  DeployBackend,
  DeployRun,
  FileWrite,
  GetToken,
  HostProvider,
  MoveEntry,
  PublishSquashInput,
  RefComparison,
  RepoSnapshot,
  RepoTree,
  RepoVisibility,
  TreeEntry,
} from '@timber/host';
import { base64ToBytes, base64ToUtf8, bytesToBase64, utf8ToBase64 } from './base64.js';

/** Same content-model file filter as the other adapters / CLI (SPEC §5). */
const SNAPSHOT_FILE = /^(content|config)\/.*\.(md|ya?ml)$/;

/** Injectable so tests can drive the adapter without a network (defaults to global `fetch`). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GitLabClientOptions {
  /** The instance origin, e.g. `https://gitlab.com` (the `/api/v4` root is appended). */
  apiBaseUrl: string;
  owner: string;
  repo: string;
  getToken: GetToken;
  /**
   * The project path, overriding `owner/repo` — needed for **nested groups**
   * (`group/subgroup/project`), which don't fit a two-part owner/repo. Defaults to
   * `${owner}/${repo}`.
   */
  projectPath?: string;
  /** Defaults to the global `fetch`; injected in tests. */
  fetchImpl?: FetchLike;
}

interface GitLabError extends Error {
  status: number;
}

function gitlabError(status: number, message: string): GitLabError {
  return Object.assign(new Error(message), { status });
}

function isStatus(err: unknown, status: number): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { status?: unknown }).status === status
  );
}

/** A single action for GitLab's Commits API (`POST /repository/commits`). */
interface GitLabAction {
  action: 'create' | 'update' | 'delete' | 'move';
  file_path: string;
  previous_path?: string;
  content?: string;
  encoding?: 'base64';
}

/**
 * Normalize a GitLab pipeline status onto the port's coarse deploy lifecycle. GitLab has
 * many statuses; the app only needs "still going" vs "done ok" vs "done bad".
 */
function pipelineOutcome(status: string): { status: string; conclusion: string | null } {
  if (status === 'success') return { status: 'completed', conclusion: 'success' };
  if (status === 'failed' || status === 'canceled' || status === 'skipped') {
    return { status: 'completed', conclusion: 'failure' };
  }
  return { status: 'in_progress', conclusion: null };
}

/**
 * A third {@link HostProvider} adapter — **GitLab** — over the GitLab REST API v4 using
 * `fetch` (no SDK). Building it exercises parts of the port the first two adapters didn't,
 * and it holds: `GitLabClient implements HostProvider` without changing `@timber/host`.
 * Notable differences, all absorbed by the adapter:
 *
 * - **Project addressing.** GitLab identifies a project by a URL-encoded *path*
 *   (`group%2Fproject`), not `owner`/`repo` — and supports nested groups. The adapter
 *   URL-encodes `owner/repo` (or an explicit `projectPath`).
 * - **Commits.** The Commits API takes an `actions[]` list (create/update/delete/**move**).
 *   A {@link MoveEntry} maps to a **native server-side `move`** (no re-upload) — cleaner
 *   than Gitea, which had to read+reupload. Writes are still classified create-vs-update
 *   against the branch tree (GitLab has no upsert), same as Gitea.
 * - **Changed paths.** The Compare API returns a real file list **with rename detection**,
 *   so `compareChangedPaths` reports `renamed` (with `previousPath`) — no tree-diffing.
 * - **Reset.** GitLab has no force-update-ref, so `resetBranch` **deletes and recreates**
 *   the (unprotected WIP) branch at the target sha.
 * - **Deploy.** GitLab CI/CD is first-class, so this adapter provides a **real
 *   {@link DeployBackend}**: `getLatestDeploy` reads the latest pipeline, `triggerDeploy`
 *   creates one. GitLab Pages is CI-artifact-based (a `pages` job), like GitHub.
 * - **Tree sha.** GitLab exposes no simple tree sha; `RepoTree.treeSha` mirrors the commit
 *   sha (nothing consumes it — it was a GitHub-internal detail).
 */
export class GitLabClient implements HostProvider {
  private readonly apiRoot: string;
  private readonly project: string;
  private readonly getToken: GetToken;
  private readonly fetchImpl: FetchLike;

  /** GitLab always has CI/CD, so a real deploy capability is always present (SPEC §12). */
  readonly deploy: DeployBackend;

  constructor(options: GitLabClientOptions) {
    this.apiRoot = `${options.apiBaseUrl.replace(/\/+$/, '')}/api/v4`;
    this.project = encodeURIComponent(
      options.projectPath ?? `${options.owner}/${options.repo}`,
    );
    this.getToken = options.getToken;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.deploy = {
      getLatestDeploy: (branch) => this.getLatestPipeline(branch),
      triggerDeploy: (ref) => this.triggerPipeline(ref),
    };
  }

  private repoPath(suffix: string): string {
    return `/projects/${this.project}${suffix}`;
  }

  /** One authenticated request; throws a status-carrying error on non-2xx. */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      // A `Bearer` token covers both OAuth access tokens and (on current GitLab) PATs.
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    };
    const res = await this.fetchImpl(`${this.apiRoot}${path}`, { ...init, headers });
    if (!res.ok) {
      throw gitlabError(
        res.status,
        `GitLab ${init?.method ?? 'GET'} ${path} -> ${res.status}`,
      );
    }
    return res;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.request(path, init)).json() as Promise<T>;
  }

  /** Fetch every page of a list endpoint, following GitLab's `x-next-page` header. */
  private async getPaged<T>(pathBase: string): Promise<T[]> {
    const sep = pathBase.includes('?') ? '&' : '?';
    const out: T[] = [];
    let page = 1;
    for (;;) {
      const res = await this.request(`${pathBase}${sep}per_page=100&page=${page}`);
      const batch = (await res.json()) as T[];
      out.push(...batch);
      const next = res.headers.get('x-next-page');
      if (batch.length === 0 || !next) break;
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) break;
      page = parsed;
    }
    return out;
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.json<{ default_branch: string }>(this.repoPath(''));
    return data.default_branch;
  }

  /** Whether the repo is public or private (SPEC §11). GitLab `internal` maps to private. */
  async getVisibility(): Promise<RepoVisibility> {
    const data = await this.json<{ visibility?: string }>(this.repoPath(''));
    if (data.visibility === 'public') return 'public';
    if (data.visibility === 'private' || data.visibility === 'internal') return 'private';
    return 'unknown';
  }

  async getBranchSha(branch: string): Promise<string | undefined> {
    try {
      const data = await this.json<{ commit: { id: string } }>(
        this.repoPath(`/repository/branches/${encodeURIComponent(branch)}`),
      );
      return data.commit.id;
    } catch (err) {
      if (isStatus(err, 404)) return undefined;
      throw err;
    }
  }

  async resolveBranch(name: string): Promise<{ name: string; sha: string } | undefined> {
    const exact = await this.getBranchSha(name);
    if (exact) return { name, sha: exact };

    const wanted = name.toLowerCase();
    const branches = await this.getPaged<{ name: string; commit: { id: string } }>(
      this.repoPath('/repository/branches'),
    );
    const match = branches.find((b) => b.name.toLowerCase() === wanted);
    return match ? { name: match.name, sha: match.commit.id } : undefined;
  }

  async loadTree(ref?: string): Promise<RepoTree> {
    const branch = ref ?? (await this.getDefaultBranch());
    const commitSha = await this.getBranchSha(branch);
    if (!commitSha)
      throw new Error(`GitLabClient.loadTree: branch "${branch}" does not exist`);

    const raw = await this.getPaged<{ id: string; type: string; path: string }>(
      this.repoPath(`/repository/tree?recursive=true&ref=${encodeURIComponent(branch)}`),
    );
    const entries: TreeEntry[] = raw
      .filter((e) => e.type === 'blob' || e.type === 'tree')
      .map((e) => ({ path: e.path, type: e.type as 'blob' | 'tree', sha: e.id }));
    // GitLab exposes no simple tree sha; nothing reads RepoTree.treeSha, so mirror the commit.
    return { ref: branch, commitSha, treeSha: commitSha, entries };
  }

  async readFile(path: string, ref?: string): Promise<string> {
    const branch = ref ?? (await this.getDefaultBranch());
    const data = await this.json<{ content?: string }>(
      this.repoPath(
        `/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      ),
    );
    if (typeof data.content !== 'string') {
      throw new Error(`GitLabClient.readFile: "${path}" has no content`);
    }
    return base64ToUtf8(data.content);
  }

  async readBlob(sha: string): Promise<string> {
    const data = await this.json<{ content: string }>(
      this.repoPath(`/repository/blobs/${sha}`),
    );
    return base64ToUtf8(data.content);
  }

  async readBinaryBlob(sha: string): Promise<Uint8Array<ArrayBuffer>> {
    const data = await this.json<{ content: string }>(
      this.repoPath(`/repository/blobs/${sha}`),
    );
    return base64ToBytes(data.content);
  }

  async loadSnapshot(ref?: string): Promise<RepoSnapshot> {
    return (await this.loadSnapshotWithTree(ref)).snapshot;
  }

  async loadSnapshotWithTree(
    ref?: string,
  ): Promise<{ snapshot: RepoSnapshot; tree: RepoTree }> {
    const tree = await this.loadTree(ref);
    const textEntries = tree.entries.filter(
      (e) => e.type === 'blob' && SNAPSHOT_FILE.test(e.path),
    );
    const snapshot: RepoSnapshot = new Map();
    await Promise.all(
      textEntries.map(async (entry) => {
        snapshot.set(entry.path, await this.readBlob(entry.sha));
      }),
    );
    return { snapshot, tree };
  }

  async getAuthenticatedLogin(): Promise<string> {
    const data = await this.json<{ username?: string }>(`/user`);
    if (!data.username)
      throw new Error('GitLabClient.getAuthenticatedLogin: no username in /user');
    return data.username;
  }

  /** path -> blob sha for a ref, to classify writes create-vs-update (GitLab has no upsert). */
  private async blobShaByPath(ref: string): Promise<Map<string, string>> {
    const tree = await this.loadTree(ref);
    return new Map(
      tree.entries.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]),
    );
  }

  /** Translate the host-neutral write set into GitLab commit actions, classified against `ref`. */
  private async buildActions(
    ref: string,
    files: FileWrite[],
    deletions: string[],
    moves: MoveEntry[],
  ): Promise<GitLabAction[]> {
    const shaByPath = await this.blobShaByPath(ref);
    const actions: GitLabAction[] = [];

    const write = (path: string, content: string): void => {
      actions.push({
        action: shaByPath.has(path) ? 'update' : 'create',
        file_path: path,
        content,
        encoding: 'base64',
      });
    };

    for (const file of files) {
      write(
        file.path,
        'bytes' in file ? bytesToBase64(file.bytes) : utf8ToBase64(file.content),
      );
    }
    for (const path of deletions) {
      if (shaByPath.has(path)) actions.push({ action: 'delete', file_path: path });
    }
    for (const move of moves) {
      if (move.from === move.to) {
        // Re-add (restore after a cancelled delete): the file is gone, so recreate from its
        // bytes. GitLab can't reference a blob by sha in a write, so read + re-upload.
        const bytes = await this.readBinaryBlob(move.sha);
        write(move.to, bytesToBase64(bytes));
      } else {
        // Pure relocation → native server-side move (no re-upload).
        actions.push({ action: 'move', previous_path: move.from, file_path: move.to });
      }
    }
    return actions;
  }

  /** POST a commit built from `actions`; returns the new commit sha. */
  private async commitActions(
    branch: string,
    startBranch: string | undefined,
    message: string,
    actions: GitLabAction[],
  ): Promise<string> {
    const data = await this.json<{ id: string }>(this.repoPath('/repository/commits'), {
      method: 'POST',
      body: JSON.stringify({
        branch,
        ...(startBranch ? { start_branch: startBranch } : {}),
        commit_message: message,
        actions,
      }),
    });
    return data.id;
  }

  async commitFiles(input: CommitFilesInput): Promise<CommitResult> {
    const exists = (await this.getBranchSha(input.branch)) !== undefined;
    // A missing branch is created from the base in the same commit via `start_branch`;
    // classify writes against whatever branch supplies the starting tree.
    const classifyRef = exists
      ? input.branch
      : (input.baseBranch ?? (await this.getDefaultBranch()));
    const actions = await this.buildActions(
      classifyRef,
      input.files,
      input.deletions ?? [],
      input.moves ?? [],
    );
    const sha = await this.commitActions(
      input.branch,
      exists ? undefined : classifyRef,
      input.message,
      actions,
    );
    return { sha };
  }

  async compareChangedPaths(base: string, head: string): Promise<ChangedPath[]> {
    const data = await this.json<{
      diffs?: {
        old_path?: string;
        new_path?: string;
        new_file?: boolean;
        renamed_file?: boolean;
        deleted_file?: boolean;
      }[];
    }>(
      this.repoPath(
        `/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}`,
      ),
    );

    return (data.diffs ?? []).map((d) => {
      const path = d.new_path ?? d.old_path ?? '';
      let status = 'modified';
      if (d.new_file) status = 'added';
      else if (d.deleted_file) status = 'removed';
      else if (d.renamed_file) status = 'renamed';
      return {
        path,
        status,
        ...(d.renamed_file && d.old_path ? { previousPath: d.old_path } : {}),
      };
    });
  }

  async resetBranch(branch: string, toSha: string): Promise<void> {
    // GitLab has no force-update-ref; delete then recreate the (unprotected WIP) branch.
    try {
      await this.request(
        this.repoPath(`/repository/branches/${encodeURIComponent(branch)}`),
        {
          method: 'DELETE',
        },
      );
    } catch (err) {
      if (!isStatus(err, 404)) throw err; // already gone is fine
    }
    await this.request(
      this.repoPath(
        `/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(toSha)}`,
      ),
      { method: 'POST' },
    );
  }

  async compareRefs(base: string, head: string): Promise<RefComparison> {
    const data = await this.json<{ commits?: unknown[] }>(
      this.repoPath(
        `/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}`,
      ),
    );
    const aheadBy = Array.isArray(data.commits) ? data.commits.length : 0;
    return { status: aheadBy > 0 ? 'ahead' : 'identical', aheadBy, behindBy: 0 };
  }

  async publishSquash(input: PublishSquashInput): Promise<CommitResult> {
    // Replay WIP's change set onto the default branch as one commit (correct for both the
    // clean and rebase strategies — GitLab has no tree-merge). Reuses the Commits API.
    const shaByPathMain = await this.blobShaByPath(input.defaultBranch);
    const actions: GitLabAction[] = [];
    for (const change of input.changes) {
      if (change.status === 'removed') {
        if (shaByPathMain.has(change.path))
          actions.push({ action: 'delete', file_path: change.path });
        continue;
      }
      const file = await this.json<{ content?: string }>(
        this.repoPath(
          `/repository/files/${encodeURIComponent(change.path)}?ref=${encodeURIComponent(input.wipBranch)}`,
        ),
      );
      if (typeof file.content !== 'string') continue;
      actions.push({
        action: shaByPathMain.has(change.path) ? 'update' : 'create',
        file_path: change.path,
        content: file.content,
        encoding: 'base64',
      });
      // A rename came through with the old path; drop it if it still lives on main.
      if (
        change.previousPath &&
        change.previousPath !== change.path &&
        shaByPathMain.has(change.previousPath)
      ) {
        actions.push({ action: 'delete', file_path: change.previousPath });
      }
    }

    const sha = await this.commitActions(
      input.defaultBranch,
      undefined,
      input.message,
      actions,
    );
    await this.resetBranch(input.wipBranch, sha);
    return { sha };
  }

  // --- Deploy (GitLab CI/CD pipelines; SPEC §12) ---

  private async getLatestPipeline(branch?: string): Promise<DeployRun | undefined> {
    const q = `?per_page=1&order_by=id&sort=desc${branch ? `&ref=${encodeURIComponent(branch)}` : ''}`;
    const list = await this.json<
      { status: string; web_url: string; ref?: string; created_at: string }[]
    >(this.repoPath(`/pipelines${q}`));
    const pipeline = list[0];
    if (!pipeline) return undefined;
    const { status, conclusion } = pipelineOutcome(pipeline.status);
    return {
      status,
      conclusion,
      url: pipeline.web_url,
      headBranch: pipeline.ref ?? null,
      createdAt: pipeline.created_at,
    };
  }

  private async triggerPipeline(ref: string): Promise<void> {
    await this.request(this.repoPath('/pipeline'), {
      method: 'POST',
      body: JSON.stringify({ ref }),
    });
  }
}
