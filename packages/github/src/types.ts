export interface RepoClientOptions {
  owner: string;
  repo: string;
  getToken: import('./token.js').GetToken;
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

/** The result of loading a branch's content into memory (SPEC §11: "the browser is a cache"). */
export interface RepoTree {
  ref: string;
  commitSha: string;
  treeSha: string;
  entries: TreeEntry[];
}

export interface FileWrite {
  path: string;
  content: string;
}

export interface CommitFilesInput {
  /** Branch to commit to; created from `baseBranch` if it doesn't exist yet. */
  branch: string;
  /** Only used when `branch` doesn't exist yet. Defaults to the repo's default branch. */
  baseBranch?: string;
  message: string;
  files: FileWrite[];
}

export interface CommitResult {
  sha: string;
}
