import { Octokit } from '@octokit/rest';
import { base64ToUtf8, bytesToBase64, utf8ToBase64 } from './base64.js';
import type {
  ChangedPath,
  CommitFilesInput,
  CommitResult,
  CommitTreeInput,
  FileWrite,
  RepoClientOptions,
  RepoSnapshot,
  RepoTree,
  TreeEntry,
  TreeOverlayEntry,
  WorkflowRun,
} from './types.js';

/**
 * Text files the content model reads (SPEC §5): Markdown bundles + schema/config
 * YAML under `content/` and `config/`. Binary assets aren't loaded into the
 * snapshot — mirrors the CLI's `buildSnapshotFromDir`.
 */
const SNAPSHOT_FILE = /^(content|config)\/.*\.(md|ya?ml)$/;

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status?: unknown }).status === 404
  );
}

/**
 * Load a repo's content into memory, edit a file, commit back (SPEC §11 / build
 * order Phase 2). Built on the low-level Git Data API (blob -> tree -> commit ->
 * ref update) rather than the Contents API, because Phase 5 needs coalesced
 * multi-file commits — this client's `commitFiles` already supports N files in
 * one commit; a single file is just the N=1 case.
 *
 * Auth is fetched fresh via `getToken()` before every request (a `before-request`
 * hook), not cached at construction: a `getToken()` rejection surfaces per-call
 * as a clear error rather than being silently retried, and a refreshed/short-lived
 * token is picked up automatically on the next call.
 */
export class RepoClient {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;

  constructor(options: RepoClientOptions) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.octokit = new Octokit();
    this.octokit.hook.before('request', async (requestOptions) => {
      const token = await options.getToken();
      requestOptions.headers.authorization = `Bearer ${token}`;
    });
  }

  async getDefaultBranch(): Promise<string> {
    const { data } = await this.octokit.rest.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    return data.default_branch;
  }

  /** The branch tip commit SHA, or `undefined` if the branch doesn't exist yet. */
  async getBranchSha(branch: string): Promise<string | undefined> {
    try {
      const { data } = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${branch}`,
      });
      return data.object.sha;
    } catch (err) {
      if (isNotFoundError(err)) return undefined;
      throw err;
    }
  }

  /** Load a branch's full file tree into memory (paths + blob SHAs, not content). */
  async loadTree(ref?: string): Promise<RepoTree> {
    const branch = ref ?? (await this.getDefaultBranch());
    const commitSha = await this.getBranchSha(branch);
    if (!commitSha) {
      throw new Error(`RepoClient.loadTree: branch "${branch}" does not exist`);
    }

    const { data: commit } = await this.octokit.rest.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: commitSha,
    });
    const { data: tree } = await this.octokit.rest.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: commit.tree.sha,
      recursive: '1',
    });

    const entries: TreeEntry[] = tree.tree.flatMap((entry) => {
      if (
        typeof entry.path !== 'string' ||
        typeof entry.sha !== 'string' ||
        (entry.type !== 'blob' && entry.type !== 'tree')
      ) {
        return [];
      }
      return [
        {
          path: entry.path,
          type: entry.type,
          sha: entry.sha,
          ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
        },
      ];
    });

    return { ref: branch, commitSha, treeSha: commit.tree.sha, entries };
  }

  /** Read and decode one text file's content at a given ref (default branch if omitted). */
  async readFile(path: string, ref?: string): Promise<string> {
    const branch = ref ?? (await this.getDefaultBranch());
    const { data } = await this.octokit.rest.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path,
      ref: branch,
    });

    if (Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') {
      throw new Error(`RepoClient.readFile: "${path}" is not a file`);
    }

    return base64ToUtf8(data.content);
  }

  /** Read and decode one blob's text content by its SHA (from a loaded tree). */
  async readBlob(sha: string): Promise<string> {
    const { data } = await this.octokit.rest.git.getBlob({
      owner: this.owner,
      repo: this.repo,
      file_sha: sha,
    });
    return base64ToUtf8(data.content);
  }

  /**
   * Load a branch's content-model text files into an in-memory {@link RepoSnapshot}
   * (`path -> utf8`), fetching all blobs concurrently. This is the browser
   * counterpart to the CLI's `buildSnapshotFromDir`; the result feeds
   * `assembleContent` from `@timber/content`.
   */
  async loadSnapshot(ref?: string): Promise<RepoSnapshot> {
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
    return snapshot;
  }

  /** The login of the authenticated user — used to derive their `<login>_wip` branch. */
  async getAuthenticatedLogin(): Promise<string> {
    const { data } = await this.octokit.rest.users.getAuthenticated();
    return data.login;
  }

  private async createBlob(file: FileWrite): Promise<{ path: string; sha: string }> {
    const content = 'bytes' in file ? bytesToBase64(file.bytes) : utf8ToBase64(file.content);
    const { data } = await this.octokit.rest.git.createBlob({
      owner: this.owner,
      repo: this.repo,
      content,
      encoding: 'base64',
    });
    return { path: file.path, sha: data.sha };
  }

  /**
   * Commit one or more files to a branch in a single commit, creating the branch
   * from `baseBranch` (default: the repo's default branch) if it doesn't exist yet.
   */
  async commitFiles(input: CommitFilesInput): Promise<CommitResult> {
    const { branch, message, files } = input;

    let baseSha = await this.getBranchSha(branch);
    if (!baseSha) {
      const baseBranch = input.baseBranch ?? (await this.getDefaultBranch());
      const baseBranchSha = await this.getBranchSha(baseBranch);
      if (!baseBranchSha) {
        throw new Error(
          `RepoClient.commitFiles: base branch "${baseBranch}" does not exist`,
        );
      }
      await this.octokit.rest.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${branch}`,
        sha: baseBranchSha,
      });
      baseSha = baseBranchSha;
    }

    const { data: baseCommit } = await this.octokit.rest.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: baseSha,
    });

    const blobs = await Promise.all(files.map((file) => this.createBlob(file)));

    const { data: newTree } = await this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseCommit.tree.sha,
      tree: blobs.map((blob) => ({
        path: blob.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.sha,
      })),
    });

    const { data: newCommit } = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message,
      tree: newTree.sha,
      parents: [baseSha],
    });

    await this.octokit.rest.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

    return { sha: newCommit.sha };
  }

  // --- Publish / merge primitives (SPEC §11; Slice 5b) ---

  /**
   * Files changed between two refs/SHAs — powers both the publish diff review
   * (main…wip) and the conflict overlap check (base…main vs base…wip).
   */
  async compareChangedPaths(base: string, head: string): Promise<ChangedPath[]> {
    const { data } = await this.octokit.rest.repos.compareCommitsWithBasehead({
      owner: this.owner,
      repo: this.repo,
      basehead: `${base}...${head}`,
    });
    return (data.files ?? []).map((f) => ({
      path: f.filename,
      status: f.status,
      ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
    }));
  }

  /** The tree SHA at a commit (the squash source). */
  async treeShaOf(commitSha: string): Promise<string> {
    const { data } = await this.octokit.rest.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: commitSha,
    });
    return data.tree.sha;
  }

  /**
   * Build a new tree = `baseTreeSha` with `entries` overlaid (a `null` sha deletes
   * the path). Reuses existing blob SHAs — no re-upload. This is the rebased tree:
   * current main's tree with the WIP branch's changed files applied on top.
   */
  async overlayTree(baseTreeSha: string, entries: TreeOverlayEntry[]): Promise<string> {
    const { data } = await this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseTreeSha,
      tree: entries.map((e) => ({
        path: e.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: e.sha,
      })),
    });
    return data.sha;
  }

  /**
   * Create one commit from an existing tree SHA and move a branch to it — the
   * squash primitive (tree = WIP's, parent = main tip). `force` for a non-fast-
   * forward move (e.g. resetting WIP).
   */
  async commitTree(input: CommitTreeInput): Promise<CommitResult> {
    const { data: commit } = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: input.message,
      tree: input.treeSha,
      parents: input.parents,
    });
    await this.octokit.rest.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${input.branch}`,
      sha: commit.sha,
      ...(input.force ? { force: true } : {}),
    });
    return { sha: commit.sha };
  }

  /** Force-reset a branch to a SHA (SPEC §11: reset WIP from new main after publish). */
  async resetBranch(branch: string, toSha: string): Promise<void> {
    await this.octokit.rest.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branch}`,
      sha: toSha,
      force: true,
    });
  }

  /**
   * The most recent run of a workflow (by file name, e.g. `deploy.yml`), optionally
   * for one branch — powers the editor's deploy-status indicator (SPEC §12:
   * "building… / published ✓ / failed").
   */
  async getLatestWorkflowRun(workflowFile: string, branch?: string): Promise<WorkflowRun | undefined> {
    const { data } = await this.octokit.rest.actions.listWorkflowRuns({
      owner: this.owner,
      repo: this.repo,
      workflow_id: workflowFile,
      per_page: 1,
      ...(branch ? { branch } : {}),
    });
    const run = data.workflow_runs[0];
    if (!run) return undefined;
    return {
      status: run.status ?? '',
      conclusion: run.conclusion ?? null,
      url: run.html_url,
      headBranch: run.head_branch ?? null,
      createdAt: run.created_at,
    };
  }
}
