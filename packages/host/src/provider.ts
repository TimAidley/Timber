import type {
  ChangedPath,
  CommitFilesInput,
  CommitResult,
  DeployRun,
  PublishSquashInput,
  RefComparison,
  RepoSnapshot,
  RepoTree,
  RepoVisibility,
} from './types.js';

/**
 * The host-provider seam (the git counterpart to SPEC §9's `getToken()` auth seam and
 * §10's `canAccessAdvanced()` roles seam). The editor talks to a git host — load content,
 * commit edits, publish, watch the deploy — only through this port, so the concrete host
 * (GitHub today; GitLab/Gitea/self-hosted later) is a swappable adapter. Timber ships one
 * adapter, `@timber/github`'s `RepoClient`; a site picks one via config.
 *
 * The port is split into capabilities:
 * - {@link HostRepo}     — read/write git content + publish (always required).
 * - {@link HostIdentity} — who is signed in (drives the per-user WIP branch, SPEC §11).
 * - {@link DeployBackend} — trigger/observe a site build (OPTIONAL: a self-hosted git
 *   with no CI simply omits it, and the editor degrades — no publish-morph, no update
 *   banner — rather than assuming GitHub Actions).
 */

/** Read and write a repo's content over whatever transport the host provides. */
export interface HostRepo {
  /** The repo's default branch name (e.g. `main`). */
  getDefaultBranch(): Promise<string>;
  /**
   * Whether the content repo is public or private — `unknown` if the host can't report it
   * (SPEC §11). Lets the editor warn before, say, marking content public on a repo it can't
   * confirm is private. A pure query; adapters map their host's repo-metadata field.
   */
  getVisibility(): Promise<RepoVisibility>;
  /** A branch's tip commit SHA, or `undefined` if the branch doesn't exist. */
  getBranchSha(branch: string): Promise<string | undefined>;
  /**
   * Resolve a branch by name, tolerant of case — the WIP branch is seeded from a login
   * (`<login>_wip`) and logins are case-insensitive while git refs are not (SPEC §11).
   * Returns the branch's ACTUAL stored name + tip SHA, or `undefined` if none matches.
   */
  resolveBranch(name: string): Promise<{ name: string; sha: string } | undefined>;
  /** Load a branch's full file tree (paths + content handles, not bytes). */
  loadTree(ref?: string): Promise<RepoTree>;
  /** Read and decode one text file's content at a ref (default branch if omitted). */
  readFile(path: string, ref?: string): Promise<string>;
  /** Read and decode one file's text content by its content handle (from a loaded tree). */
  readBlob(sha: string): Promise<string>;
  /** Read one file's **raw bytes** by its content handle — for binary assets (images). */
  readBinaryBlob(sha: string): Promise<Uint8Array<ArrayBuffer>>;
  /** Load a branch's content-model text files into an in-memory {@link RepoSnapshot}. */
  loadSnapshot(ref?: string): Promise<RepoSnapshot>;
  /** Like {@link loadSnapshot}, but also returns the full {@link RepoTree}. */
  loadSnapshotWithTree(ref?: string): Promise<{ snapshot: RepoSnapshot; tree: RepoTree }>;
  /** Commit one or more files (with optional deletions/moves) to a branch in one commit. */
  commitFiles(input: CommitFilesInput): Promise<CommitResult>;
  /** Files changed between two refs/SHAs (publish diff main…wip; conflict overlap check). */
  compareChangedPaths(base: string, head: string): Promise<ChangedPath[]>;
  /** Force-move a branch to a SHA (SPEC §11: reset WIP from new main after publish). */
  resetBranch(branch: string, toSha: string): Promise<void>;
  /** How `head` stands relative to `base` — ahead/behind counts + status (SPEC §12). */
  compareRefs(base: string, head: string): Promise<RefComparison>;
  /**
   * Squash-merge the WIP branch onto the default branch and reset WIP to the new tip,
   * returning the new default-branch SHA (SPEC §11). The app decides *whether* to publish
   * and computes the plan; the adapter owns the host-specific mechanics of building the
   * squashed commit. See {@link PublishSquashInput}.
   */
  publishSquash(input: PublishSquashInput): Promise<CommitResult>;
}

/** Who is signed in — the per-user WIP branch `<login>_wip` is derived from it (SPEC §11). */
export interface HostIdentity {
  /** The login of the authenticated user. */
  getAuthenticatedLogin(): Promise<string>;
}

/**
 * Trigger and observe a site build/deploy (SPEC §12). Optional on a {@link HostProvider}:
 * a host without CI has none, and the editor hides the deploy-status morph and the
 * out-of-date banner instead of assuming a workflow exists.
 */
export interface DeployBackend {
  /**
   * The latest deploy of the site, optionally for one branch — powers the Publish
   * button's morph (building… → published ✓ / failed).
   */
  getLatestDeploy(branch?: string): Promise<DeployRun | undefined>;
  /**
   * Kick off a deploy of `ref`. Used to re-run a build after a transient deploy failure,
   * and to redeploy a newer editor (SPEC §12). No-op-safe: hosts that deploy purely on
   * push may implement this as a fresh empty-commit or a native "retry" — the app only
   * needs the deploy to run again.
   */
  triggerDeploy(ref: string): Promise<void>;
}

/**
 * A concrete git host the editor edits against (SPEC §3: single-tenant, one per site).
 * Always provides {@link HostRepo} + {@link HostIdentity}; {@link DeployBackend} is
 * present only when the host has a build/deploy pipeline Timber can drive.
 */
export interface HostProvider extends HostRepo, HostIdentity {
  /** Build/deploy capability, or `undefined` when the host has no CI Timber can drive. */
  readonly deploy?: DeployBackend;
}
