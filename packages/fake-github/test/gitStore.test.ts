import { describe, expect, it } from 'vitest';
import { EMPTY_TREE_SHA, GitStore } from '../src/index.js';

const utf8 = (s: string) => new TextEncoder().encode(s);

// Reference values computed with real git (`git hash-object`, `git write-tree`), so a
// drift in the fake's serialization shows up as a wrong sha rather than a subtly
// different-but-internally-consistent store.
describe('GitStore hashes like git', () => {
  it('blob sha matches `git hash-object`', async () => {
    const store = new GitStore();
    expect(await store.putBlob(utf8('hello'))).toBe(
      'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0',
    );
  });

  it('empty tree has the well-known sha', async () => {
    const store = new GitStore();
    expect(await store.putTree([])).toBe(EMPTY_TREE_SHA);
  });

  it('nested tree sha matches `git write-tree`', async () => {
    const store = new GitStore();
    const a = await store.putBlob(utf8('hello'));
    const b = await store.putBlob(utf8('world\n'));
    expect(b).toBe('cc628ccd10742baea8241c5924df992b5c019f71');
    const tree = await store.treeFromBlobs(
      new Map([
        ['a.txt', { mode: '100644', sha: a }],
        ['sub/b.txt', { mode: '100644', sha: b }],
      ]),
    );
    expect(tree).toBe('7fff7a17dd3d430caefadbcc25f5d433a551cfb5');
    expect(store.flattenTree(tree).map((e) => `${e.type} ${e.path}`)).toEqual([
      'blob a.txt',
      'tree sub',
      'blob sub/b.txt',
    ]);
  });

  it('overlayTree deletes with a null sha and drops emptied directories', async () => {
    const store = new GitStore();
    const a = await store.putBlob(utf8('hello'));
    const b = await store.putBlob(utf8('world\n'));
    const base = await store.treeFromBlobs(
      new Map([
        ['a.txt', { mode: '100644', sha: a }],
        ['sub/b.txt', { mode: '100644', sha: b }],
      ]),
    );
    const next = await store.overlayTree(base, [{ path: 'sub/b.txt', sha: null }]);
    expect([...store.blobsOf(next).keys()]).toEqual(['a.txt']);
    expect(store.flattenTree(next).some((e) => e.type === 'tree')).toBe(false);
  });

  it('diffTrees reports added/modified/removed and exact-content renames', async () => {
    const store = new GitStore();
    const a = await store.putBlob(utf8('a'));
    const a2 = await store.putBlob(utf8('a2'));
    const img = await store.putBlob(utf8('png-bytes'));
    const gone = await store.putBlob(utf8('gone'));
    const before = await store.treeFromBlobs(
      new Map([
        ['content/x/index.md', { mode: '100644', sha: a }],
        ['content/x/pic.webp', { mode: '100644', sha: img }],
        ['content/old.md', { mode: '100644', sha: gone }],
      ]),
    );
    const after = await store.treeFromBlobs(
      new Map([
        ['content/x/index.md', { mode: '100644', sha: a2 }],
        ['content/y/pic.webp', { mode: '100644', sha: img }],
        ['content/new.md', { mode: '100644', sha: a }],
      ]),
    );
    expect(store.diffTrees(before, after)).toEqual([
      { filename: 'content/new.md', status: 'added' },
      { filename: 'content/old.md', status: 'removed' },
      { filename: 'content/x/index.md', status: 'modified' },
      {
        filename: 'content/y/pic.webp',
        status: 'renamed',
        previous_filename: 'content/x/pic.webp',
      },
    ]);
  });

  it('mergeBase / countAhead follow the commit graph', async () => {
    const store = new GitStore();
    const tree = await store.putTree([]);
    const who = { name: 'x', email: 'x@y', date: '2026-01-01T00:00:00Z' };
    const root = await store.putCommit({
      tree,
      parents: [],
      message: 'root',
      author: who,
    });
    const m1 = await store.putCommit({
      tree,
      parents: [root.sha],
      message: 'main 1',
      author: who,
    });
    const w1 = await store.putCommit({
      tree,
      parents: [root.sha],
      message: 'wip 1',
      author: who,
    });
    const w2 = await store.putCommit({
      tree,
      parents: [w1.sha],
      message: 'wip 2',
      author: who,
    });

    expect(store.mergeBase(m1.sha, w2.sha)).toBe(root.sha);
    expect(store.countAhead(m1.sha, w2.sha)).toBe(2);
    expect(store.countAhead(w2.sha, m1.sha)).toBe(1);
    expect(store.isAncestor(root.sha, w2.sha)).toBe(true);
    expect(store.isAncestor(m1.sha, w2.sha)).toBe(false);
  });
});
