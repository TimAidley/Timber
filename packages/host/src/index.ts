/**
 * @timber/host — the host-provider port (SPEC §9-style seam, for the git host rather
 * than auth). The editor depends on these host-neutral types and interfaces; a concrete
 * git host (GitHub today via `@timber/github`; GitLab/Gitea/self-hosted later) is a
 * swappable adapter that implements {@link HostProvider}.
 */
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
  RepoVisibility,
  TreeEntry,
} from './types.js';

export type { DeployBackend, HostIdentity, HostProvider, HostRepo } from './provider.js';
