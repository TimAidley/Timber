import { describe, expect, it, vi } from 'vitest';
import type { ChangedPath } from '@timber/host';
import { classifyForeignPaths, detectForeignChange, type ForeignWatchClient } from '../src/state/foreignChanges.js';
import { OwnWrites } from '../src/state/ownWrites.js';

/**
 * The WIP branch is shared (a second tab, another device), and every tab edits its own
 * in-memory copy taken at load time. Two tabs on *different* files is harmless and must
 * stay silent; two tabs on the *same* file overwrites silently, with no error, because
 * it's a clean fast-forward. This is the watcher that makes the second case visible —
 * so the thing it must never do is cry wolf over our own commits.
 */

function client(tip: string | undefined, changed: ChangedPath[] = []): ForeignWatchClient {
  return {
    getBranchSha: async () => tip,
    compareChangedPaths: async () => changed,
  };
}

const noWait = async (): Promise<void> => undefined;

function opts(over: Partial<Parameters<typeof detectForeignChange>[1]> = {}) {
  return {
    branch: 'me_wip',
    own: new OwnWrites(),
    knownTip: 'aaa',
    pendingBase: undefined,
    editingPaths: new Set<string>(),
    settleMs: 0,
    settle: noWait,
    ...over,
  };
}

describe('detectForeignChange', () => {
  it('says nothing when the tip is where we left it', async () => {
    const result = await detectForeignChange(client('aaa'), opts());
    expect(result).toEqual({ tip: undefined, change: null });
  });

  it('reports another writer’s commit, with what they changed', async () => {
    const result = await detectForeignChange(
      client('bbb', [{ path: 'content/pages/about/index.md', status: 'modified' }]),
      opts(),
    );
    expect(result.tip).toBe('bbb');
    expect(result.change).toEqual({
      sha: 'bbb',
      baseSha: 'aaa',
      paths: [{ path: 'content/pages/about/index.md', status: 'modified', overlapping: false }],
    });
  });

  it('flags the files we are also editing — the ones our next save overwrites', async () => {
    const result = await detectForeignChange(
      client('bbb', [
        { path: 'content/pages/about/index.md', status: 'modified' },
        { path: 'content/pages/home/index.md', status: 'modified' },
      ]),
      opts({ editingPaths: new Set(['content/pages/home/index.md']) }),
    );
    // Clashing file first — it's the one with a decision attached.
    expect(result.change?.paths[0]).toEqual({
      path: 'content/pages/home/index.md',
      status: 'modified',
      overlapping: true,
    });
    expect(result.change?.paths[1]?.overlapping).toBe(false);
  });

  it('never reports our own commit as foreign', async () => {
    const own = new OwnWrites();
    own.record('bbb');
    const compare = vi.fn(async () => []);
    const result = await detectForeignChange({ getBranchSha: async () => 'bbb', compareChangedPaths: compare }, opts({ own }));

    expect(result.change).toBeNull();
    expect(result.tip).toBe('bbb'); // adopted as the new baseline
    expect(compare).not.toHaveBeenCalled();
  });

  it('does not cry wolf when our commit is recorded during the settle window', async () => {
    // The real race: our commit reaches the host a beat before `commitFiles` returns and
    // records its sha. A poll landing in that gap must not report us to ourselves.
    const own = new OwnWrites();
    const result = await detectForeignChange(
      client('bbb', [{ path: 'content/pages/home/index.md', status: 'modified' }]),
      opts({
        own,
        settle: async () => {
          own.record('bbb');
        },
      }),
    );
    expect(result.change).toBeNull();
    expect(result.tip).toBe('bbb');
  });

  it('adopts the tip silently when there is no baseline to diff against', async () => {
    // Loaded before the WIP branch existed — the first tip we see is just the baseline.
    const result = await detectForeignChange(client('bbb'), opts({ knownTip: undefined }));
    expect(result).toEqual({ tip: 'bbb', change: null });
  });

  it('stays quiet when the moved tip changed nothing (e.g. a branch reset)', async () => {
    const result = await detectForeignChange(client('bbb', []), opts());
    expect(result).toEqual({ tip: 'bbb', change: null });
  });

  it('keeps diffing from the first unreviewed base as more commits arrive', async () => {
    // A second foreign commit must not narrow the warning to just its own slice —
    // the author hasn't seen the earlier one yet.
    const compare = vi.fn(async () => [{ path: 'content/pages/home/index.md', status: 'modified' as const }]);
    const result = await detectForeignChange(
      { getBranchSha: async () => 'ccc', compareChangedPaths: compare },
      opts({ knownTip: 'bbb', pendingBase: 'aaa' }),
    );
    expect(compare).toHaveBeenCalledWith('aaa', 'ccc');
    expect(result.change?.baseSha).toBe('aaa');
  });
});

describe('classifyForeignPaths', () => {
  it('sorts clashes first, then by path', async () => {
    const paths = classifyForeignPaths(
      [
        { path: 'b.md', status: 'modified' },
        { path: 'a.md', status: 'added' },
        { path: 'z.md', status: 'modified' },
      ],
      new Set(['z.md']),
    );
    expect(paths.map((p) => p.path)).toEqual(['z.md', 'a.md', 'b.md']);
  });
});
