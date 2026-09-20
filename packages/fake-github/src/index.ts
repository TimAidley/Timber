/**
 * @timber/fake-github — an in-memory GitHub for driving the editor without the network.
 *
 * Three entry points:
 * - `.`            the fake itself (browser-safe: Web Crypto, fetch primitives, no Node APIs);
 * - `./node`       seeding a repo from a directory on disk (e.g. `site-template/`);
 * - `./playwright` routing a real browser's `api.github.com` traffic through the fake.
 */
export { FakeGitHub } from './router.js';
export type { Fault, FakeGitHubOptions, ServedRequest } from './router.js';
export { FakeRepo, RefConflictError } from './repo.js';
export type { FakeRepoOptions, FileMap } from './repo.js';
export { FakeActions } from './actions.js';
export type { ActionsOptions, RunConclusion, WorkflowRunRecord } from './actions.js';
export { GitStore, UnknownObjectError } from './objects.js';
export type {
  CommitObject,
  FileChange,
  FlatEntry,
  GitIdentity,
  TreeEntryRecord,
  TreeObject,
  TreeOverlay,
} from './objects.js';
export { EMPTY_TREE_SHA, gitObjectSha } from './hash.js';
