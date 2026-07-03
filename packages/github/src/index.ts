/**
 * @timber/github — load a GitHub repo's content into memory, edit files, commit
 * back (SPEC §9, §11; build order Phase 2). Isomorphic: Octokit's client is
 * fetch-based, so this runs unchanged in the browser and in Node.
 */
export { RepoClient } from './client.js';
export { fromEnv } from './token.js';

export type { GetToken } from './token.js';
export type {
  CommitFilesInput,
  CommitResult,
  FileWrite,
  RepoClientOptions,
  RepoTree,
  TreeEntry,
} from './types.js';
