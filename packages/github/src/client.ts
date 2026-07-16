import { Octokit } from '@octokit/rest';
import type { DeployBackend, HostProvider, PublishSquashInput } from '@timber/host';
import { base64ToBytes, base64ToUtf8, bytesToBase64, utf8ToBase64 } from './base64.js';
import type {
  ChangedPath,
  CommitFilesInput,
  CommitResult,
  CommitTreeInput,
  FileWrite,
  RepoClientOptions,
  RepoSnapshot,
  RefComparison,
  RepoTree,
  TreeEntry,
  TreeOverlayEntry,
  WorkflowRun,
} from './types.js';

/** The GitHub Actions workflow file the site-template ships for build+deploy (SPEC §12). */
const DEFAULT_DEPLOY_WORKFLOW = 'deploy.yml';

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
 * GitHub rejects a non-forced `updateRef` with 422 "Update is not a fast forward"
 * when the branch tip has moved since we read our base — another editor tab, or the
 * refs read lagging just after our previous autosave. We recover by re-reading the
 * tip and re-applying our changes on top of it (see `commitFiles`).
 */
function isNonFastForwardError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status?: unknown }).status === 422 &&
    /not a fast forward/i.test((err as { message?: unknown }).message?.toString() ?? '')
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
export class RepoClient implements HostProvider {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly deployWorkflow: string;

  /**
   * The optional {@link DeployBackend} capability (SPEC §12). GitHub always has Actions,
   * so this adapter always provides it — mapping the port's host-neutral deploy calls
   * onto the site-template's deploy workflow. Built once so its identity is stable (React
   * effect deps compare it by reference).
   */
  readonly deploy: DeployBackend;

  constructor(options: RepoClientOptions) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.deployWorkflow = options.deployWorkflow ?? DEFAULT_DEPLOY_WORKFLOW;
    this.octokit = new Octokit();
    this.octokit.hook.before('request', async (requestOptions) => {
      const token = await options.getToken();
      requestOptions.headers.authorization = `Bearer ${token}`;
    });
    this.deploy = {
      getLatestDeploy: (branch) => this.getLatestWorkflowRun(this.deployWorkflow, branch),
      triggerDeploy: (ref) => this.dispatchWorkflow(this.deployWorkflow, ref),
    };
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

  /**
   * Resolve a branch by name, tolerant of case. Git refs are case-sensitive, but the
   * WIP branch name is seeded from the GitHub login (`<login>_wip`) and logins are
   * case-insensitive: `GET /user` returns the canonical `TimAidley` while the branch may
   * have been created as `timaidley_wip`. An exact-name lookup would miss it, and the
   * caller would then fork a second, divergent WIP branch on the next commit. Returns the
   * branch's ACTUAL stored name (exact match preferred, so the common correctly-cased
   * case costs a single request) and tip SHA, or `undefined` when nothing matches even
   * case-insensitively.
   */
  async resolveBranch(name: string): Promise<{ name: string; sha: string } | undefined> {
    const exact = await this.getBranchSha(name);
    if (exact) return { name, sha: exact };

    const wanted = name.toLowerCase();
    const branches = await this.octokit.paginate(this.octokit.rest.repos.listBranches, {
      owner: this.owner,
      repo: this.repo,
      per_page: 100,
    });
    const match = branches.find((b) => b.name.toLowerCase() === wanted);
    return match ? { name: match.name, sha: match.commit.sha } : undefined;
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

  /** Read one blob's **raw bytes** by its SHA — for binary assets (committed images). */
  async readBinaryBlob(sha: string): Promise<Uint8Array<ArrayBuffer>> {
    const { data } = await this.octokit.rest.git.getBlob({
      owner: this.owner,
      repo: this.repo,
      file_sha: sha,
    });
    return base64ToBytes(data.content);
  }

  /**
   * Load a branch's content-model text files into an in-memory {@link RepoSnapshot}
   * (`path -> utf8`), fetching all blobs concurrently. This is the browser
   * counterpart to the CLI's `buildSnapshotFromDir`; the result feeds
   * `assembleContent` from `@timber/content`.
   */
  async loadSnapshot(ref?: string): Promise<RepoSnapshot> {
    return (await this.loadSnapshotWithTree(ref)).snapshot;
  }

  /**
   * Like {@link loadSnapshot}, but also returns the full {@link RepoTree}. The editor
   * keeps the tree so object delete/rename can enumerate a bundle's colocated **asset**
   * paths (the content model only carries `index.md`) and reuse existing blob SHAs when
   * moving them (SPEC §5).
   */
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

  /** The login of the authenticated user — used to derive their `<login>_wip` branch. */
  async getAuthenticatedLogin(): Promise<string> {
    const { data } = await this.octokit.rest.users.getAuthenticated();
    return data.login;
  }

  private async createBlob(file: FileWrite): Promise<{ path: string; sha: string }> {
    const content =
      'bytes' in file ? bytesToBase64(file.bytes) : utf8ToBase64(file.content);
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
    const deletions = input.deletions ?? [];
    const moves = input.moves ?? [];

    let tipSha = await this.getBranchSha(branch);
    if (!tipSha) {
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
      tipSha = baseBranchSha;
    }

    // Upload blobs once — they're content-addressed, so they're reused unchanged if
    // we have to rebuild the tree/commit on a moved tip below.
    const blobs = await Promise.all(files.map((file) => this.createBlob(file)));

    // A single tree overlaid on the base: new/updated blobs, blob-reusing moves
    // (add at `to`, drop `from`), and deletions (`sha: null` removes the path). A
    // move with `from === to` is a **re-add** (re-attach an existing blob at its own
    // path without deleting it) — used to restore a bundle's assets after a cancelled
    // delete; it contributes the `to` write but no `from` deletion.
    const treeEntries = [
      ...blobs.map((blob) => ({
        path: blob.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.sha,
      })),
      ...moves.map((move) => ({
        path: move.to,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: move.sha,
      })),
      ...[...deletions, ...moves.filter((m) => m.from !== m.to).map((m) => m.from)].map(
        (path) => ({
          path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: null,
        }),
      ),
    ];

    // Build the commit on the current tip and fast-forward the ref. If the ref moved
    // under us (a concurrent tab, or the refs read lagging just after our previous
    // autosave), GitHub rejects the non-forced update with 422 "not a fast forward";
    // we re-read the tip and re-apply our overlay on top of it — never forcing, so a
    // genuinely concurrent commit is preserved, not clobbered. Our files are layered
    // over `base_tree`, so the other commit's changes survive too.
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; ; attempt += 1) {
      const { data: baseCommit } = await this.octokit.rest.git.getCommit({
        owner: this.owner,
        repo: this.repo,
        commit_sha: tipSha,
      });

      const { data: newTree } = await this.octokit.rest.git.createTree({
        owner: this.owner,
        repo: this.repo,
        base_tree: baseCommit.tree.sha,
        tree: treeEntries,
      });

      const { data: newCommit } = await this.octokit.rest.git.createCommit({
        owner: this.owner,
        repo: this.repo,
        message,
        tree: newTree.sha,
        parents: [tipSha],
      });

      try {
        await this.octokit.rest.git.updateRef({
          owner: this.owner,
          repo: this.repo,
          ref: `heads/${branch}`,
          sha: newCommit.sha,
        });
        return { sha: newCommit.sha };
      } catch (err) {
        const latest = await this.getBranchSha(branch);
        // Give up if we're out of attempts, it's not a fast-forward race, or the tip
        // hasn't actually advanced (a stale read that a retry can't fix — let the
        // caller's backoff retry once the refs read catches up).
        if (
          attempt >= MAX_ATTEMPTS ||
          !isNonFastForwardError(err) ||
          !latest ||
          latest === tipSha
        ) {
          throw err;
        }
        tipSha = latest;
      }
    }
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

  /**
   * Intent-level publish (SPEC §11): squash-merge WIP onto the default branch and reset
   * WIP to the new tip. The app decides *whether* to publish and computes the plan (clean
   * vs rebase, conflict detection); this maps that plan onto GitHub's blob→tree→commit
   * model — the mechanics another host would express differently. `clean` reuses WIP's
   * tree wholesale (main hasn't moved); `rebase` overlays WIP's changed files onto main's
   * current tree (main moved but the files don't overlap).
   */
  async publishSquash(input: PublishSquashInput): Promise<CommitResult> {
    let treeSha: string;
    if (input.strategy === 'clean') {
      // WIP was built on the (unchanged) main tip, so its tree IS the squash result.
      treeSha = await this.treeShaOf(input.wipTip);
    } else {
      // Rebase: main's tree with WIP's changed files overlaid on top.
      const mainTree = await this.treeShaOf(input.parentSha);
      const wipTree = await this.loadTree(input.wipBranch);
      const wipByPath = new Map(
        wipTree.entries.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]),
      );
      const entries: TreeOverlayEntry[] = [];
      for (const c of input.changes) {
        if (c.status === 'removed') {
          entries.push({ path: c.path, sha: null });
          continue;
        }
        const sha = wipByPath.get(c.path);
        if (sha) entries.push({ path: c.path, sha });
        if (c.previousPath) entries.push({ path: c.previousPath, sha: null }); // renamed: drop old
      }
      treeSha = await this.overlayTree(mainTree, entries);
    }

    const { sha } = await this.commitTree({
      branch: input.defaultBranch,
      message: input.message,
      treeSha,
      parents: [input.parentSha],
    });
    await this.resetBranch(input.wipBranch, sha);
    return { sha };
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
  async getLatestWorkflowRun(
    workflowFile: string,
    branch?: string,
  ): Promise<WorkflowRun | undefined> {
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

  /**
   * How `head` stands relative to `base` — commits ahead/behind and a coarse status
   * (`ahead`/`behind`/`identical`/`diverged`). One call resolves both refs (branch,
   * tag, or SHA) and their ancestry. Powers the editor's out-of-date check: is the
   * Timber commit the editor was built from behind the branch it follows? (SPEC §12).
   */
  async compareRefs(base: string, head: string): Promise<RefComparison> {
    const { data } = await this.octokit.rest.repos.compareCommitsWithBasehead({
      owner: this.owner,
      repo: this.repo,
      basehead: `${base}...${head}`,
    });
    return { status: data.status, aheadBy: data.ahead_by, behindBy: data.behind_by };
  }

  /**
   * Manually trigger a workflow (`workflow_dispatch`) on a branch/tag. Used to
   * **re-run the deploy** after a transient Pages-deploy failure — the publish
   * (squash-merge to main) already succeeded, so recovery is re-running the deploy,
   * not re-publishing (SPEC §12). Requires the token's `actions: write` scope, which
   * `repo`/OAuth grants; the deploy workflow must declare `workflow_dispatch`.
   */
  async dispatchWorkflow(workflowFile: string, ref: string): Promise<void> {
    await this.octokit.rest.actions.createWorkflowDispatch({
      owner: this.owner,
      repo: this.repo,
      workflow_id: workflowFile,
      ref,
    });
  }
}
