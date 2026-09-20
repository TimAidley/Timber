import { bytesOfHex, concatBytes, gitObjectSha } from './hash.js';

/** One entry of a (single-level) git tree object. `name` is the entry's own name, not a path. */
export interface TreeEntryRecord {
  name: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
}

export interface TreeObject {
  sha: string;
  entries: TreeEntryRecord[];
}

export interface CommitObject {
  sha: string;
  tree: string;
  parents: string[];
  message: string;
  author: GitIdentity;
  committer: GitIdentity;
}

export interface GitIdentity {
  name: string;
  email: string;
  /** ISO 8601, as GitHub reports it. */
  date: string;
}

/** A file in a flattened tree — the shape `GET /git/trees/:sha?recursive=1` lists. */
export interface FlatEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

/** One overlay onto a base tree, as `POST /git/trees` takes it; `sha: null` deletes the path. */
export interface TreeOverlay {
  path: string;
  mode?: string;
  sha: string | null;
}

/** One file's change between two trees, as GitHub's compare endpoint reports it. */
export interface FileChange {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  previous_filename?: string;
}

const encoder = new TextEncoder();

/**
 * Git's tree-entry ordering: byte-wise by name, except a subtree sorts as if its name
 * had a trailing `/`. Getting this wrong changes the tree sha, so it's kept exact.
 */
function sortKey(entry: TreeEntryRecord): string {
  return entry.type === 'tree' ? `${entry.name}/` : entry.name;
}

function compareEntries(a: TreeEntryRecord, b: TreeEntryRecord): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * The content-addressed object store behind a fake repo: blobs, trees and commits keyed
 * by their real git sha (see `hash.ts`), plus the graph queries GitHub's API exposes over
 * them (recursive tree listing, ancestry, merge base, tree diff). Refs live on the repo,
 * not here — this is purely the immutable half of git.
 */
export class GitStore {
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly trees = new Map<string, TreeObject>();
  private readonly commits = new Map<string, CommitObject>();

  // --- blobs ---------------------------------------------------------------

  async putBlob(bytes: Uint8Array): Promise<string> {
    const sha = await gitObjectSha('blob', bytes);
    if (!this.blobs.has(sha)) this.blobs.set(sha, bytes);
    return sha;
  }

  getBlob(sha: string): Uint8Array | undefined {
    return this.blobs.get(sha);
  }

  // --- trees ---------------------------------------------------------------

  async putTree(entries: readonly TreeEntryRecord[]): Promise<string> {
    const sorted = [...entries].sort(compareEntries);
    // Git stores modes without the leading zero GitHub displays (`40000`, not `040000`);
    // serializing the padded form would change every tree sha.
    const body = concatBytes(
      ...sorted.map((e) =>
        concatBytes(
          encoder.encode(`${e.mode.replace(/^0+/, '')} ${e.name}\0`),
          bytesOfHex(e.sha),
        ),
      ),
    );
    const sha = await gitObjectSha('tree', body);
    if (!this.trees.has(sha)) this.trees.set(sha, { sha, entries: sorted });
    return sha;
  }

  getTree(sha: string): TreeObject | undefined {
    return this.trees.get(sha);
  }

  /** Every entry under a tree with its full path — subtrees included, as GitHub lists them. */
  flattenTree(sha: string, prefix = ''): FlatEntry[] {
    const tree = this.trees.get(sha);
    if (!tree) throw new Error(`GitStore: unknown tree ${sha}`);
    const out: FlatEntry[] = [];
    for (const entry of tree.entries) {
      const path = prefix + entry.name;
      if (entry.type === 'tree') {
        out.push({ path, mode: entry.mode, type: 'tree', sha: entry.sha });
        out.push(...this.flattenTree(entry.sha, `${path}/`));
      } else {
        const size = this.blobs.get(entry.sha)?.length;
        out.push({
          path,
          mode: entry.mode,
          type: 'blob',
          sha: entry.sha,
          ...(size !== undefined ? { size } : {}),
        });
      }
    }
    return out;
  }

  /** The blobs under a tree as `path → {mode, sha}` (no subtree rows). */
  blobsOf(treeSha: string): Map<string, { mode: string; sha: string }> {
    const out = new Map<string, { mode: string; sha: string }>();
    for (const entry of this.flattenTree(treeSha)) {
      if (entry.type === 'blob')
        out.set(entry.path, { mode: entry.mode, sha: entry.sha });
    }
    return out;
  }

  /**
   * Build a tree from a flat `path → blob` map, nesting directories and hashing bottom-up.
   * Empty directories cannot exist (as in git): a directory with no remaining blobs simply
   * isn't emitted.
   */
  async treeFromBlobs(
    blobs: ReadonlyMap<string, { mode: string; sha: string }>,
  ): Promise<string> {
    interface Dir {
      files: TreeEntryRecord[];
      dirs: Map<string, Dir>;
    }
    const root: Dir = { files: [], dirs: new Map() };
    for (const [path, blob] of blobs) {
      const segments = path.split('/');
      const name = segments.pop()!;
      let dir = root;
      for (const seg of segments) {
        let next = dir.dirs.get(seg);
        if (!next) {
          next = { files: [], dirs: new Map() };
          dir.dirs.set(seg, next);
        }
        dir = next;
      }
      dir.files.push({ name, mode: blob.mode, type: 'blob', sha: blob.sha });
    }
    const write = async (dir: Dir): Promise<string> => {
      const entries: TreeEntryRecord[] = [...dir.files];
      for (const [name, sub] of dir.dirs) {
        entries.push({ name, mode: '040000', type: 'tree', sha: await write(sub) });
      }
      return this.putTree(entries);
    };
    return write(root);
  }

  /**
   * `POST /git/trees` semantics: the base tree with `overlays` applied. Paths are given
   * flat (`content/x/index.md`) and may reach into any depth; a `null` sha removes the
   * path. Paths must name blobs — the client only ever writes files.
   */
  async overlayTree(
    baseTreeSha: string | undefined,
    overlays: readonly TreeOverlay[],
  ): Promise<string> {
    const blobs = baseTreeSha
      ? this.blobsOf(baseTreeSha)
      : new Map<string, { mode: string; sha: string }>();
    for (const o of overlays) {
      const path = o.path.replace(/^\/+/, '');
      if (o.sha === null) {
        blobs.delete(path);
      } else {
        if (!this.blobs.has(o.sha))
          throw new UnknownObjectError(`tree.sha ${o.sha} is not a valid blob`);
        blobs.set(path, { mode: o.mode ?? '100644', sha: o.sha });
      }
    }
    return this.treeFromBlobs(blobs);
  }

  // --- commits -------------------------------------------------------------

  async putCommit(input: {
    tree: string;
    parents: readonly string[];
    message: string;
    author: GitIdentity;
    committer?: GitIdentity;
  }): Promise<CommitObject> {
    if (!this.trees.has(input.tree))
      throw new UnknownObjectError(`Tree SHA ${input.tree} does not exist`);
    for (const p of input.parents) {
      if (!this.commits.has(p))
        throw new UnknownObjectError(`Parent SHA ${p} does not exist`);
    }
    const committer = input.committer ?? input.author;
    const ident = (who: GitIdentity) => {
      const seconds = Math.floor(new Date(who.date).getTime() / 1000);
      return `${who.name} <${who.email}> ${seconds} +0000`;
    };
    const lines = [
      `tree ${input.tree}`,
      ...input.parents.map((p) => `parent ${p}`),
      `author ${ident(input.author)}`,
      `committer ${ident(committer)}`,
      '',
      input.message,
    ];
    const sha = await gitObjectSha('commit', encoder.encode(lines.join('\n')));
    const existing = this.commits.get(sha);
    if (existing) return existing;
    const commit: CommitObject = {
      sha,
      tree: input.tree,
      parents: [...input.parents],
      message: input.message,
      author: input.author,
      committer,
    };
    this.commits.set(sha, commit);
    return commit;
  }

  getCommit(sha: string): CommitObject | undefined {
    return this.commits.get(sha);
  }

  hasCommit(sha: string): boolean {
    return this.commits.has(sha);
  }

  // --- graph queries -------------------------------------------------------

  /** Every commit reachable from `sha`, itself included. */
  ancestorsOf(sha: string): Set<string> {
    const seen = new Set<string>();
    const stack = [sha];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const commit = this.commits.get(cur);
      if (commit) stack.push(...commit.parents);
    }
    return seen;
  }

  /** Is `ancestor` reachable from `descendant` (a commit is its own ancestor)? */
  isAncestor(ancestor: string, descendant: string): boolean {
    return this.ancestorsOf(descendant).has(ancestor);
  }

  /**
   * The nearest common ancestor of two commits — breadth-first from `b` through the
   * ancestor set of `a`, so the first hit is the closest one for the (near-)linear
   * histories a WIP-branch workflow produces. Undefined for unrelated histories.
   */
  mergeBase(a: string, b: string): string | undefined {
    const fromA = this.ancestorsOf(a);
    const queue = [b];
    const seen = new Set<string>();
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      if (fromA.has(cur)) return cur;
      const commit = this.commits.get(cur);
      if (commit) queue.push(...commit.parents);
    }
    return undefined;
  }

  /** Commits reachable from `head` but not from `base` — GitHub's `ahead_by`. */
  countAhead(base: string, head: string): number {
    const excluded = this.ancestorsOf(base);
    let n = 0;
    for (const sha of this.ancestorsOf(head)) if (!excluded.has(sha)) n += 1;
    return n;
  }

  /**
   * Files changed from one tree to another. Renames are detected only for an
   * exact-content match (a removed path and an added path sharing a blob sha) — which is
   * how the editor's asset moves look. GitHub also pairs *similar* files as renamed
   * (an `index.md` moved with a slug edit inside it); the fake reports those as
   * removed + added instead. Bear that in mind when a test leans on `previous_filename`.
   */
  diffTrees(baseTreeSha: string, headTreeSha: string): FileChange[] {
    const before = this.blobsOf(baseTreeSha);
    const after = this.blobsOf(headTreeSha);
    const removed = new Map<string, string>(); // sha → path, for rename pairing
    const changes: FileChange[] = [];

    for (const [path, b] of before) {
      const a = after.get(path);
      if (!a) removed.set(b.sha, path);
      else if (a.sha !== b.sha) changes.push({ filename: path, status: 'modified' });
    }
    for (const [path, a] of after) {
      if (before.has(path)) continue;
      const from = removed.get(a.sha);
      if (from) {
        removed.delete(a.sha);
        changes.push({ filename: path, status: 'renamed', previous_filename: from });
      } else {
        changes.push({ filename: path, status: 'added' });
      }
    }
    for (const path of removed.values())
      changes.push({ filename: path, status: 'removed' });

    return changes.sort((x, y) =>
      x.filename < y.filename ? -1 : x.filename > y.filename ? 1 : 0,
    );
  }
}

/** A referenced git object doesn't exist — GitHub answers these with 422. */
export class UnknownObjectError extends Error {}
