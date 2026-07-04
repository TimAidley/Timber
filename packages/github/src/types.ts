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

/**
 * A file to write in a commit. Text (`content`) covers Markdown/YAML/templates;
 * binary (`bytes`) covers processed images from the editor's upload pipeline
 * (SPEC §7) — both become base64 Git Data API blobs.
 */
export type FileWrite = { path: string; content: string } | { path: string; bytes: Uint8Array };

/** An in-memory snapshot of a repo's text files, keyed by repo-relative path. */
export type RepoSnapshot = Map<string, string>;

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

/** One file changed between two commits (SPEC §11 publish diff / conflict overlap). */
export interface ChangedPath {
  path: string;
  /** GitHub status: added | modified | removed | renamed | copied | changed. */
  status: string;
  /** For `renamed`, the old path. */
  previousPath?: string;
}

/** An entry to overlay onto a base tree; `sha: null` deletes the path. */
export interface TreeOverlayEntry {
  path: string;
  sha: string | null;
}

export interface CommitTreeInput {
  branch: string;
  message: string;
  /** An existing tree SHA to commit as-is (the squash/rebase result). */
  treeSha: string;
  parents: string[];
  /** Force-move the branch ref (non-fast-forward). Default false. */
  force?: boolean;
}
