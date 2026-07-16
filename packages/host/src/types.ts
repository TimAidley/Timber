/**
 * Host-neutral value types the editor depends on. These describe git/content
 * concepts (branches, trees, blobs, file changes, ref comparisons) in terms that
 * every git host can satisfy — they carry no GitHub-specific shape. The GitHub
 * adapter (`@timber/github`) maps them onto Octokit; a future GitLab/Gitea adapter
 * maps them onto its own API. (Types tied to one host's wire format — e.g. GitHub's
 * blob→tree→commit model — stay inside that adapter, not here.)
 */

/**
 * The auth seam (SPEC §9): the rest of the app only ever needs "a valid token" — the
 * mechanism (a pasted PAT, an OAuth broker, a device flow, a host-specific App) can be
 * swapped without touching callers. A {@link HostProvider} depends only on this type.
 */
export type GetToken = () => Promise<string>;

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

/** The result of loading a branch's file tree into memory (SPEC §11: "the browser is a cache"). */
export interface RepoTree {
  ref: string;
  commitSha: string;
  treeSha: string;
  entries: TreeEntry[];
}

/**
 * A file to write in a commit. Text (`content`) covers Markdown/YAML/templates; binary
 * (`bytes`) covers processed images from the editor's upload pipeline (SPEC §7).
 */
export type FileWrite =
  { path: string; content: string } | { path: string; bytes: Uint8Array };

/** An in-memory snapshot of a repo's text files, keyed by repo-relative path. */
export type RepoSnapshot = Map<string, string>;

/**
 * Relocate an existing file to a new path without re-uploading its bytes. A move with
 * `from === to` is a **re-add**: it re-attaches the file at its own path without a
 * deletion — used to restore a bundle's colocated assets after a cancelled delete.
 * (`sha` is the host's content handle for the existing bytes; opaque to callers.)
 */
export interface MoveEntry {
  from: string;
  to: string;
  sha: string;
}

export interface CommitFilesInput {
  /** Branch to commit to; created from `baseBranch` if it doesn't exist yet. */
  branch: string;
  /** Only used when `branch` doesn't exist yet. Defaults to the repo's default branch. */
  baseBranch?: string;
  message: string;
  files: FileWrite[];
  /** Paths to remove in the same commit. Powers object delete and rename's old side (SPEC §5). */
  deletions?: string[];
  /**
   * Paths to move by **reusing an existing content handle** — no re-upload of the bytes.
   * Each writes `to` and deletes `from`; used to relocate a bundle's colocated assets on
   * rename (SPEC §5). The moved `index.md` is a normal `files` write plus a `from` deletion.
   */
  moves?: MoveEntry[];
}

export interface CommitResult {
  sha: string;
}

/** One file changed between two commits (SPEC §11 publish diff / conflict overlap). */
export interface ChangedPath {
  path: string;
  /** Normalized status: added | modified | removed | renamed | copied | changed. */
  status: string;
  /** For `renamed`, the old path. */
  previousPath?: string;
}

/**
 * How one ref stands relative to another. Powers the editor's "your build is out of
 * date" check: compare the Timber commit the editor was built from against the tip of
 * the branch it follows (SPEC §12).
 */
export interface RefComparison {
  /** `ahead` | `behind` | `identical` | `diverged`, relative to `base`. */
  status: string;
  /** Commits `head` has that `base` doesn't (how far the followed ref moved on). */
  aheadBy: number;
  /** Commits `base` has that `head` doesn't. */
  behindBy: number;
}

/**
 * Intent-level publish: squash-merge the WIP branch onto the default branch and reset
 * WIP to the new tip (SPEC §11). The *decision* of whether/how to publish (validity gate,
 * clean vs rebase, conflict detection) is host-neutral and stays in the app; only the
 * mechanics of building the squashed commit are the adapter's job — GitHub uses its
 * blob/tree/commit API, another host its own. So this input carries the app's already-
 * computed plan, not raw tree SHAs.
 */
export interface PublishSquashInput {
  defaultBranch: string;
  wipBranch: string;
  /** The current default-branch tip; parent of the squash commit. */
  parentSha: string;
  /** The WIP branch tip whose tree is the publish result (used by the `clean` strategy). */
  wipTip: string;
  message: string;
  /**
   * `clean`: main hasn't moved, so WIP's tree IS the squash result. `rebase`: main moved
   * but the changed files don't overlap, so overlay WIP's changed files onto main's tree.
   */
  strategy: 'clean' | 'rebase';
  /** WIP's changed paths since the conflict base — the overlay set for `rebase`. */
  changes: ChangedPath[];
}

/**
 * The latest deploy of the site — drives the editor's deploy-status indicator (SPEC §12:
 * "building… / published ✓ / failed"). Host-neutral: GitHub maps a Workflow run onto it,
 * GitLab a pipeline, etc. A host with no CI has no {@link DeployBackend} at all.
 */
export interface DeployRun {
  /** Coarse lifecycle: `queued` | `in_progress` | `completed` (host statuses normalized). */
  status: string;
  /** `success` | `failure` | `cancelled` | … | null while running. */
  conclusion: string | null;
  /** Link to the deploy/run on the host. */
  url: string;
  /** The branch the deploy ran for, if known. */
  headBranch: string | null;
  /** ISO timestamp the deploy was created — lets the poll distinguish a new run from a stale one. */
  createdAt: string;
}
