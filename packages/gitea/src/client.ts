import type {
  ChangedPath,
  CommitFilesInput,
  CommitResult,
  DeployBackend,
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

/** Same content-model file filter as the GitHub adapter / CLI (SPEC §5). */
const SNAPSHOT_FILE = /^(content|config)\/.*\.(md|ya?ml)$/;

/** Injectable so tests can drive the adapter without a network (defaults to global `fetch`). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GiteaClientOptions {
  /** The instance origin, e.g. `https://codeberg.org` (the `/api/v1` root is appended). */
  apiBaseUrl: string;
  owner: string;
  repo: string;
  getToken: GetToken;
  /** Defaults to the global `fetch`; injected in tests. */
  fetchImpl?: FetchLike;
}

interface GiteaError extends Error {
  status: number;
}

function giteaError(status: number, message: string): GiteaError {
  return Object.assign(new Error(message), { status });
}

function isStatus(err: unknown, status: number): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { status?: unknown }).status === status
  );
}

/** A single file operation for Gitea's "modify multiple files" (ChangeFiles) endpoint. */
interface GiteaFileOp {
  operation: 'create' | 'update' | 'delete';
  path: string;
  /** base64 content for create/update. */
  content?: string;
  /** the CURRENT blob sha being replaced/removed (update/delete) — Gitea's optimistic lock. */
  sha?: string;
}

/** URL-encode a repo-relative path while preserving its slashes. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * A second {@link HostProvider} adapter — Gitea / Forgejo (which powers **Codeberg**) —
 * over the Gitea REST API using `fetch` (no SDK, no Octokit). Its purpose is to prove the
 * host seam is genuinely host-neutral: nothing GitHub-shaped leaks into `@timber/host`.
 *
 * Where the two hosts differ, the adapter absorbs the impedance so the port stays clean:
 *
 * - **Commits.** GitHub builds a commit from a blob→tree→commit overlay. Gitea has no such
 *   low-level tree write; instead its **ChangeFiles** endpoint takes a list of create/
 *   update/delete file operations and makes one commit. So `commitFiles` maps directly to
 *   ChangeFiles — but Gitea needs each write classified create-vs-update (and an update/
 *   delete needs the *current* blob sha), which GitHub's overlay doesn't. The adapter
 *   fetches the branch tree to classify, keeping `CommitFilesInput` unchanged.
 * - **Blob reuse on move.** GitHub relocates bytes by sha without re-uploading. Gitea's
 *   ChangeFiles has no "reuse this sha" — so a {@link MoveEntry} is realised by reading the
 *   bytes (its `sha` is the opaque content handle the port promised) and re-uploading them.
 *   The port's `MoveEntry.sha` stays valid; only the adapter's cost model differs.
 * - **Publish.** GitHub squashes by composing a tree. Gitea replays the WIP change set onto
 *   the default branch as one ChangeFiles commit — which needs neither `wipTip` nor the
 *   clean/rebase distinction, so `publishSquash` carries enough for both hosts, forcing
 *   neither into the other's model.
 * - **Changed paths.** GitHub's compare returns a file list (with rename detection). Gitea's
 *   doesn't reliably, so the adapter diffs the two trees by path+sha (adds/removes/mods; a
 *   rename reads as add+remove — fine for publish and pending-delete detection).
 * - **Deploy.** Codeberg Pages is branch-based with no build to trigger/observe, so this
 *   adapter provides **no {@link DeployBackend}** (`deploy` is undefined) and the editor
 *   degrades gracefully (SPEC §12). Gitea/Forgejo Actions could be wired here later, exactly
 *   as the GitHub adapter wires Actions.
 */
export class GiteaClient implements HostProvider {
  private readonly apiRoot: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly getToken: GetToken;
  private readonly fetchImpl: FetchLike;

  /**
   * Codeberg Pages has no CI to drive — see the class doc. Left absent (`undefined` at
   * runtime) so the editor's deploy morph / update banner degrade gracefully (SPEC §12).
   */
  readonly deploy?: DeployBackend;

  constructor(options: GiteaClientOptions) {
    this.apiRoot = `${options.apiBaseUrl.replace(/\/+$/, '')}/api/v1`;
    this.owner = options.owner;
    this.repo = options.repo;
    this.getToken = options.getToken;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private repoPath(suffix: string): string {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${suffix}`;
  }

  /** One authenticated request; throws a status-carrying error on non-2xx. */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `token ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    };
    const res = await this.fetchImpl(`${this.apiRoot}${path}`, { ...init, headers });
    if (!res.ok) {
      throw giteaError(
        res.status,
        `Gitea ${init?.method ?? 'GET'} ${path} -> ${res.status}`,
      );
    }
    return res;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.request(path, init)).json() as Promise<T>;
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.json<{ default_branch: string }>(this.repoPath(''));
    return data.default_branch;
  }

  /**
   * Whether the repo is public or private (SPEC §11). Gitea/Forgejo reports `private` on
   * the repo object; `unknown` if a response ever omits it (honouring the port contract).
   */
  async getVisibility(): Promise<RepoVisibility> {
    const data = await this.json<{ private?: boolean }>(this.repoPath(''));
    if (typeof data.private !== 'boolean') return 'unknown';
    return data.private ? 'private' : 'public';
  }

  async getBranchSha(branch: string): Promise<string | undefined> {
    try {
      const data = await this.json<{ commit: { id: string } }>(
        this.repoPath(`/branches/${encodePath(branch)}`),
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
    for (let page = 1; ; page += 1) {
      const branches = await this.json<{ name: string; commit: { id: string } }[]>(
        this.repoPath(`/branches?page=${page}&limit=50`),
      );
      const match = branches.find((b) => b.name.toLowerCase() === wanted);
      if (match) return { name: match.name, sha: match.commit.id };
      if (branches.length < 50) return undefined;
    }
  }

  async loadTree(ref?: string): Promise<RepoTree> {
    const branch = ref ?? (await this.getDefaultBranch());
    const commitSha = await this.getBranchSha(branch);
    if (!commitSha)
      throw new Error(`GiteaClient.loadTree: branch "${branch}" does not exist`);

    const commit = await this.json<{
      commit?: { tree?: { sha?: string } };
      tree?: { sha?: string };
    }>(this.repoPath(`/git/commits/${commitSha}`));
    const treeSha = commit.commit?.tree?.sha ?? commit.tree?.sha;
    if (!treeSha)
      throw new Error(`GiteaClient.loadTree: no tree sha for commit ${commitSha}`);

    // Gitea paginates trees (default/max 1000 per page); loop until total_count collected.
    const entries: TreeEntry[] = [];
    for (let page = 1; ; page += 1) {
      const data = await this.json<{
        tree: { path: string; type: string; sha: string; size?: number }[];
        total_count: number;
      }>(
        this.repoPath(`/git/trees/${treeSha}?recursive=true&page=${page}&per_page=1000`),
      );
      for (const e of data.tree) {
        if (e.type !== 'blob' && e.type !== 'tree') continue;
        entries.push({
          path: e.path,
          type: e.type,
          sha: e.sha,
          ...(typeof e.size === 'number' ? { size: e.size } : {}),
        });
      }
      if (entries.length >= data.total_count || data.tree.length === 0) break;
    }

    return { ref: branch, commitSha, treeSha, entries };
  }

  async readFile(path: string, ref?: string): Promise<string> {
    const branch = ref ?? (await this.getDefaultBranch());
    const data = await this.json<{ content?: string; encoding?: string; type?: string }>(
      this.repoPath(`/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`),
    );
    if (data.type !== 'file' || typeof data.content !== 'string') {
      throw new Error(`GiteaClient.readFile: "${path}" is not a file`);
    }
    return base64ToUtf8(data.content);
  }

  async readBlob(sha: string): Promise<string> {
    const data = await this.json<{ content: string }>(this.repoPath(`/git/blobs/${sha}`));
    return base64ToUtf8(data.content);
  }

  async readBinaryBlob(sha: string): Promise<Uint8Array<ArrayBuffer>> {
    const data = await this.json<{ content: string }>(this.repoPath(`/git/blobs/${sha}`));
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
    const data = await this.json<{ login?: string; username?: string }>(`/user`);
    const login = data.login ?? data.username;
    if (!login)
      throw new Error('GiteaClient.getAuthenticatedLogin: no login in /user response');
    return login;
  }

  /**
   * A blob-sha lookup for a branch's files — Gitea needs the current sha to update/delete,
   * and needs to know which paths already exist to pick create vs update.
   */
  private async blobShaByPath(ref: string): Promise<Map<string, string>> {
    const tree = await this.loadTree(ref);
    return new Map(
      tree.entries.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]),
    );
  }

  /** Translate the host-neutral write set into Gitea file ops, classified against `ref`. */
  private async buildFileOps(
    ref: string,
    files: FileWrite[],
    deletions: string[],
    moves: MoveEntry[],
  ): Promise<GiteaFileOp[]> {
    const shaByPath = await this.blobShaByPath(ref);
    const ops: GiteaFileOp[] = [];

    const write = (path: string, content: string): void => {
      const existing = shaByPath.get(path);
      ops.push(
        existing
          ? { operation: 'update', path, content, sha: existing }
          : { operation: 'create', path, content },
      );
    };

    for (const file of files) {
      write(
        file.path,
        'bytes' in file ? bytesToBase64(file.bytes) : utf8ToBase64(file.content),
      );
    }
    for (const path of deletions) {
      const sha = shaByPath.get(path);
      if (sha) ops.push({ operation: 'delete', path, sha });
    }
    // A move reuses the port's opaque content handle (`sha`): Gitea can't reference a blob
    // by sha in a write, so read its bytes and re-upload them at `to` (+ delete `from`).
    for (const move of moves) {
      const bytes = await this.readBinaryBlob(move.sha);
      write(move.to, bytesToBase64(bytes));
      if (move.from !== move.to) {
        const fromSha = shaByPath.get(move.from);
        if (fromSha) ops.push({ operation: 'delete', path: move.from, sha: fromSha });
      }
    }
    return ops;
  }

  /** POST the ChangeFiles batch; returns the new commit sha. */
  private async changeFiles(body: {
    branch: string;
    new_branch?: string;
    message: string;
    files: GiteaFileOp[];
  }): Promise<string> {
    const data = await this.json<{ commit: { sha: string } }>(
      this.repoPath(`/contents`),
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    return data.commit.sha;
  }

  async commitFiles(input: CommitFilesInput): Promise<CommitResult> {
    const exists = (await this.getBranchSha(input.branch)) !== undefined;
    // A new branch is created from the base and committed to in one ChangeFiles call
    // (`new_branch`); classify writes against whatever branch supplies the starting tree.
    const classifyRef = exists
      ? input.branch
      : (input.baseBranch ?? (await this.getDefaultBranch()));
    const files = await this.buildFileOps(
      classifyRef,
      input.files,
      input.deletions ?? [],
      input.moves ?? [],
    );
    const sha = await this.changeFiles({
      branch: classifyRef,
      ...(exists ? {} : { new_branch: input.branch }),
      message: input.message,
      files,
    });
    return { sha };
  }

  async compareChangedPaths(base: string, head: string): Promise<ChangedPath[]> {
    // Gitea's compare doesn't reliably return a file list, so diff the two trees by
    // path+sha. A rename surfaces as add+remove (no rename detection) — acceptable for
    // publish and pending-delete detection, which key on added/removed/modified.
    const [baseTree, headTree] = await Promise.all([
      this.loadTree(base),
      this.loadTree(head),
    ]);
    const baseMap = new Map(
      baseTree.entries.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]),
    );
    const headMap = new Map(
      headTree.entries.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]),
    );

    const changed: ChangedPath[] = [];
    for (const [path, sha] of headMap) {
      const baseSha = baseMap.get(path);
      if (baseSha === undefined) changed.push({ path, status: 'added' });
      else if (baseSha !== sha) changed.push({ path, status: 'modified' });
    }
    for (const path of baseMap.keys()) {
      if (!headMap.has(path)) changed.push({ path, status: 'removed' });
    }
    return changed;
  }

  async resetBranch(branch: string, toSha: string): Promise<void> {
    await this.request(this.repoPath(`/git/refs/heads/${encodePath(branch)}`), {
      method: 'PATCH',
      body: JSON.stringify({ sha: toSha, force: true }),
    });
  }

  async compareRefs(base: string, head: string): Promise<RefComparison> {
    // Best-effort (the update banner fails silent): count the commits head has over base.
    const data = await this.json<{ total_commits?: number; commits?: unknown[] }>(
      this.repoPath(`/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`),
    );
    const aheadBy = data.total_commits ?? data.commits?.length ?? 0;
    return { status: aheadBy > 0 ? 'ahead' : 'identical', aheadBy, behindBy: 0 };
  }

  async publishSquash(input: PublishSquashInput): Promise<CommitResult> {
    // Gitea has no tree-merge; replay WIP's change set onto the default branch as one
    // ChangeFiles commit. This is correct for BOTH strategies (clean == replay all WIP
    // changes; rebase == replay WIP changes onto the moved main), so `wipTip` and the
    // clean/rebase distinction — GitHub's tree concerns — are simply unused here.
    const shaByPathMain = await this.blobShaByPath(input.defaultBranch);
    const ops: GiteaFileOp[] = [];
    for (const change of input.changes) {
      if (change.status === 'removed') {
        const sha = shaByPathMain.get(change.path);
        if (sha) ops.push({ operation: 'delete', path: change.path, sha });
        continue;
      }
      const file = await this.json<{ content?: string }>(
        this.repoPath(
          `/contents/${encodePath(change.path)}?ref=${encodeURIComponent(input.wipBranch)}`,
        ),
      );
      if (typeof file.content !== 'string') continue;
      const existing = shaByPathMain.get(change.path);
      ops.push(
        existing
          ? {
              operation: 'update',
              path: change.path,
              content: file.content,
              sha: existing,
            }
          : { operation: 'create', path: change.path, content: file.content },
      );
    }

    const sha = await this.changeFiles({
      branch: input.defaultBranch,
      message: input.message,
      files: ops,
    });
    // Reset WIP onto the new default-branch tip (SPEC §11), mirroring the GitHub adapter.
    await this.resetBranch(input.wipBranch, sha);
    return { sha };
  }
}
