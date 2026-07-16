import type { GetToken, DeployRun } from '@timber/host';

// The host-neutral types now live in `@timber/host` (the port). Re-export them so
// existing `@timber/github` importers keep working unchanged while the app migrates to
// importing straight from the port.
export type {
  ChangedPath,
  CommitFilesInput,
  CommitResult,
  DeployRun,
  FileWrite,
  GetToken,
  MoveEntry,
  PublishSquashInput,
  RefComparison,
  RepoSnapshot,
  RepoTree,
  TreeEntry,
} from '@timber/host';

/**
 * Construction config for the GitHub adapter. `owner`/`repo` are GitHub's namespace/repo
 * slug; `getToken` is the shared auth seam (SPEC §9). This is adapter-specific — the port
 * itself knows nothing about "owner/repo".
 */
export interface RepoClientOptions {
  owner: string;
  repo: string;
  getToken: GetToken;
  /**
   * The GitHub Actions workflow file that builds + deploys the site (SPEC §12), used by
   * the {@link DeployBackend} capability. Defaults to the site-template's `deploy.yml`.
   */
  deployWorkflow?: string;
}

/**
 * @deprecated Use {@link DeployRun} from `@timber/host`. Kept as an alias while callers
 * migrate — GitHub's "workflow run" is one host's realization of a deploy.
 */
export type WorkflowRun = DeployRun;

/**
 * An entry to overlay onto a base tree; `sha: null` deletes the path. GitHub-specific
 * (its blob→tree→commit model) — an internal detail of this adapter's `publishSquash`,
 * not part of the host port.
 */
export interface TreeOverlayEntry {
  path: string;
  sha: string | null;
}

/** GitHub-specific commit-from-tree input — internal to this adapter (see {@link TreeOverlayEntry}). */
export interface CommitTreeInput {
  branch: string;
  message: string;
  /** An existing tree SHA to commit as-is (the squash/rebase result). */
  treeSha: string;
  parents: string[];
  /** Force-move the branch ref (non-fast-forward). Default false. */
  force?: boolean;
}
