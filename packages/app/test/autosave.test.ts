import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileWrite, MoveEntry } from '@timber/github';
import { Autosaver, type SyncState } from '../src/state/autosave.js';

type CommitFn = (files: FileWrite[], message: string, deletions: string[], moves: MoveEntry[]) => Promise<void>;

function setup(commit: CommitFn) {
  const states: SyncState[] = [];
  const dirtyPathSets: string[][] = [];
  const saver = new Autosaver({
    commit,
    assetBytes: async (path) => (path.endsWith('.webp') ? new Uint8Array([1, 2, 3]) : undefined),
    onState: (s) => states.push(s),
    onDirtyPaths: (paths) => dirtyPathSets.push([...paths].sort()),
    idleMs: 2000,
    retryMs: 5000,
  });
  return { saver, states, dirtyPathSets };
}

describe('Autosaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces edits to multiple objects into one debounced commit', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body a');
    saver.markObjectDirty('content/people/b/index.md', { title: 'B' }, 'body b');
    expect(commit).not.toHaveBeenCalled(); // debounced, not per-keystroke

    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    const [files, message] = commit.mock.calls[0]!;
    expect(files.map((f) => f.path).sort()).toEqual([
      'content/events/a/index.md',
      'content/people/b/index.md',
    ]);
    expect(message).toBe('edit 2 items');
  });

  it('debounces rapid edits to the same object (latest content wins)', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'v1');
    await vi.advanceTimersByTimeAsync(500);
    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'v2');
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    const [files] = commit.mock.calls[0]!;
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('content/events/a/index.md');
    expect('content' in files[0]! && files[0]!.content).toContain('v2');
  });

  it('stages a created object plus asset copies (blob-SHA re-adds, no deletion)', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    // Add-translation: a new index.md + colocated assets copied by re-adding each blob at
    // the NEW path (from === to → no deletion, so the source keeps its assets).
    saver.markObjectCreated(
      'content/posts/fr/hello/index.md',
      { title: 'Bonjour', lang: 'fr', translationKey: 'G' },
      'body',
      [
        {
          from: 'content/posts/fr/hello/hero.webp',
          to: 'content/posts/fr/hello/hero.webp',
          sha: 'blobsha',
        },
      ],
    );
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    const [files, , deletions, moves] = commit.mock.calls[0]!;
    expect(files.map((f) => f.path)).toEqual(['content/posts/fr/hello/index.md']);
    expect(deletions).toEqual([]); // a copy never deletes the source
    expect(moves).toEqual([
      {
        from: 'content/posts/fr/hello/hero.webp',
        to: 'content/posts/fr/hello/hero.webp',
        sha: 'blobsha',
      },
    ]);
  });

  it('commits staged asset bytes alongside the object', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    saver.markAssetDirty('content/events/a/images/p.webp');
    await vi.advanceTimersByTimeAsync(2000);

    const [files] = commit.mock.calls[0]!;
    const asset = files.find((f) => f.path.endsWith('.webp'));
    expect(asset && 'bytes' in asset).toBe(true);
  });

  it('keeps dirty state and retries after a failed commit', async () => {
    const commit = vi
      .fn<(files: FileWrite[], message: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const { saver, states } = setup(commit);

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    await vi.advanceTimersByTimeAsync(2000);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(states).toContain('error');

    // Backoff retry re-commits the still-dirty edit.
    await vi.advanceTimersByTimeAsync(5000);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe('saved');
  });

  it('reports the cause of a failed commit, then reports the recovery', async () => {
    // A retry loop that only records failures can't distinguish "still broken" from
    // "blipped once and went through" — which is exactly the question the header's
    // "Save failed — retrying" raises. Both edges are reported.
    const boom = Object.assign(new Error('HTTP 401'), { status: 401 });
    const commit = vi.fn<CommitFn>().mockRejectedValueOnce(boom).mockResolvedValueOnce(undefined);
    const errors: unknown[] = [];
    const recovered: number[] = [];
    const saver = new Autosaver({
      commit,
      assetBytes: async () => new Uint8Array([1]),
      onState: () => undefined,
      onError: (e) => errors.push(e),
      onRecovered: (n) => recovered.push(n),
      idleMs: 2000,
      retryMs: 5000,
    });

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    await vi.advanceTimersByTimeAsync(2000);
    expect(errors).toEqual([boom]);
    expect(recovered).toEqual([]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(recovered).toEqual([1]); // succeeded after exactly one failed attempt
  });

  it('warns when staged asset bytes have vanished — a save that quietly loses a file', async () => {
    // The commit still lands (the rest of the edit is fine), so this failure is
    // invisible in the UI: the page just ends up missing its image. It must be logged.
    const commit = vi.fn<CommitFn>(async () => undefined);
    const warnings: { message: string; detail?: Record<string, unknown> }[] = [];
    const saver = new Autosaver({
      commit,
      assetBytes: async () => undefined, // staged bytes gone (reload between stage + flush)
      onState: () => undefined,
      onWarn: (message, detail) => warnings.push({ message, ...(detail ? { detail } : {}) }),
      idleMs: 2000,
    });

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    saver.markAssetDirty('content/events/a/images/p.webp');
    await vi.advanceTimersByTimeAsync(2000);

    const [files] = commit.mock.calls[0]!;
    expect(files.map((f) => f.path)).toEqual(['content/events/a/index.md']); // asset dropped
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.detail).toEqual({ path: 'content/events/a/images/p.webp' });
  });

  it('backs off exponentially on repeated failures (5s, 10s, …)', async () => {
    const commit = vi
      .fn<CommitFn>()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockResolvedValueOnce(undefined);
    const { saver } = setup(commit);

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    await vi.advanceTimersByTimeAsync(2000); // idle debounce → attempt 1 (fails)
    expect(commit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000); // first backoff = 5s → attempt 2 (fails)
    expect(commit).toHaveBeenCalledTimes(2);

    // Second backoff is 10s, not 5s: nothing fires at +5s…
    await vi.advanceTimersByTimeAsync(5000);
    expect(commit).toHaveBeenCalledTimes(2);
    // …only at +10s total.
    await vi.advanceTimersByTimeAsync(5000);
    expect(commit).toHaveBeenCalledTimes(3);
  });

  it('spreads the flush delay by the jitter ratio, so two tabs stop colliding in lockstep', async () => {
    // Two editor tabs on the same WIP branch fail together, then back off by exactly the
    // same amount and collide again. Jitter breaks the tie; the class defaults it off so
    // the timing tests above stay exact.
    const commit = vi.fn<CommitFn>(async () => undefined);
    const saver = new Autosaver({
      commit,
      assetBytes: async () => new Uint8Array([1]),
      onState: () => undefined,
      idleMs: 2000,
      jitterRatio: 0.5,
      random: () => 1, // the top of the range → 2000 * 1.5
    });

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    await vi.advanceTimersByTimeAsync(2000);
    expect(commit).not.toHaveBeenCalled(); // stretched past the nominal debounce

    await vi.advanceTimersByTimeAsync(1000);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('coalesces a deletion into the commit and names it, dropping any pending edit', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    // Edit one object, then delete another object's whole bundle.
    saver.markObjectDirty('content/events/keep/index.md', { title: 'Keep' }, 'body');
    saver.markObjectDirty('content/events/gone/index.md', { title: 'Gone' }, 'x');
    saver.markPathsDeleted(['content/events/gone/index.md', 'content/events/gone/hero.webp']);
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    const [files, message, deletions] = commit.mock.calls[0]!;
    // The deleted object's pending edit is superseded — only the kept object is written.
    expect(files.map((f) => f.path)).toEqual(['content/events/keep/index.md']);
    expect(deletions!.sort()).toEqual(['content/events/gone/hero.webp', 'content/events/gone/index.md']);
    expect(message).toBe('edit keep, delete gone');
  });

  it('commits a delete-only change (no file writes)', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markPathsDeleted(['content/events/gone/index.md']);
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    const [files, message, deletions] = commit.mock.calls[0]!;
    expect(files).toHaveLength(0);
    expect(deletions).toEqual(['content/events/gone/index.md']);
    expect(message).toBe('delete gone');
  });

  it('renames a bundle: writes the new index.md, deletes the old, moves assets by SHA', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markObjectRenamed(
      'content/events/old/index.md',
      'content/events/new/index.md',
      { id: 'e1', title: 'E', aliases: ['old'] },
      'body',
      [{ from: 'content/events/old/hero.webp', to: 'content/events/new/hero.webp', sha: 'ASSET' }],
    );
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    const [files, message, deletions, moves] = commit.mock.calls[0]!;
    // New index.md is written at the new path…
    expect(files.map((f) => f.path)).toEqual(['content/events/new/index.md']);
    // …the old index.md is deleted…
    expect(deletions).toEqual(['content/events/old/index.md']);
    // …the asset moves by reusing its blob SHA…
    expect(moves).toEqual([
      { from: 'content/events/old/hero.webp', to: 'content/events/new/hero.webp', sha: 'ASSET' },
    ]);
    // …and the summary reads as a rename, not an edit+delete.
    expect(message).toBe('rename new');
  });

  it('reports the editing (uncommitted) object set, clearing it once the commit lands', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver, dirtyPathSets } = setup(commit);

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    saver.markObjectDirty('content/people/b/index.md', { title: 'B' }, 'body');
    // Latest notification lists both dirty objects.
    expect(dirtyPathSets.at(-1)).toEqual(['content/events/a/index.md', 'content/people/b/index.md']);

    await vi.advanceTimersByTimeAsync(2000);
    // After a successful flush they're on the branch → editing set is empty.
    expect(dirtyPathSets.at(-1)).toEqual([]);
  });

  // The dirty union must be TOTAL: every kind of pending change (not just objects and
  // raw files) is in the editing set from the moment it's queued. Staged assets were
  // once left out, and a site-asset upload showed "No unpublished changes" until its
  // commit landed — the same bug advanced-area files had before them.
  it('includes staged assets and pending deletions in the editing set', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver, dirtyPathSets } = setup(commit);

    saver.markAssetDirty('assets/logo.webp');
    expect(dirtyPathSets.at(-1)).toEqual(['assets/logo.webp']);

    saver.markPathsDeleted(['themes/acme/assets/old.css']);
    expect(dirtyPathSets.at(-1)).toEqual(['assets/logo.webp', 'themes/acme/assets/old.css']);

    await vi.advanceTimersByTimeAsync(2000);
    // Landed → no longer local-only.
    expect(dirtyPathSets.at(-1)).toEqual([]);
  });

  it('keeps a staged asset in the editing set while its commit is in flight', async () => {
    let release: () => void = () => undefined;
    const commit = vi.fn<CommitFn>(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const { saver, dirtyPathSets } = setup(commit);

    saver.markAssetDirty('content/events/a/images/p.webp');
    await vi.advanceTimersByTimeAsync(2000); // flush starts, commit pending
    expect(commit).toHaveBeenCalledTimes(1);
    // In transit ≠ saved: the asset stays "editing" until the commit lands.
    expect(dirtyPathSets.at(-1)).toEqual(['content/events/a/images/p.webp']);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(dirtyPathSets.at(-1)).toEqual([]);
  });

  // Staged assets are persisted locally as a crash net; the saver announces which ones
  // a landed commit carried so those local copies can be dropped — and stays silent on
  // failure, when the local copy is still the only copy.
  it('reports committed asset paths on success, never on failure', async () => {
    const committed: string[][] = [];
    const commit = vi.fn<CommitFn>().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
    const saver = new Autosaver({
      commit,
      assetBytes: async () => new Uint8Array([1]),
      onState: () => undefined,
      onAssetsCommitted: (paths) => committed.push([...paths].sort()),
      idleMs: 2000,
      retryMs: 5000,
    });

    saver.markAssetDirty('content/events/a/images/p.webp');
    saver.markAssetDirty('assets/logo.webp');
    await vi.advanceTimersByTimeAsync(2000); // attempt 1 fails
    expect(committed).toEqual([]);

    await vi.advanceTimersByTimeAsync(5000); // backoff retry succeeds
    expect(committed).toEqual([['assets/logo.webp', 'content/events/a/images/p.webp']]);
  });

  it('keeps an object in the editing set while a failing commit retries', async () => {
    const commit = vi.fn<CommitFn>().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
    const { saver, dirtyPathSets } = setup(commit);

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    await vi.advanceTimersByTimeAsync(2000); // attempt 1 fails
    // Still editing (not yet saved) after the failure.
    expect(dirtyPathSets.at(-1)).toEqual(['content/events/a/index.md']);

    await vi.advanceTimersByTimeAsync(5000); // backoff retry succeeds
    expect(dirtyPathSets.at(-1)).toEqual([]);
  });

  it('settle() waits out an in-flight flush without starting a new one', async () => {
    let release: () => void = () => undefined;
    const commit = vi.fn<CommitFn>(() => new Promise<void>((resolve) => (release = resolve)));
    const { saver } = setup(commit);

    await saver.settle(); // idle → resolves immediately, commits nothing
    expect(commit).not.toHaveBeenCalled();

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    await vi.advanceTimersByTimeAsync(2000); // flush starts, commit hangs
    let settled = false;
    const settling = saver.settle().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false); // still in flight

    release();
    await settling;
    expect(commit).toHaveBeenCalledTimes(1); // settle never triggered a second flush
  });

  // The discard fence: forget → settle → forget again. A flush in flight when the
  // discard starts snapshotted the dirty maps BEFORE the forget; if it fails, it
  // restores that snapshot — and without the second forget the next flush would
  // re-commit the very edits the user just discarded.
  it('forget → settle → forget clears edits a failing in-flight flush restored', async () => {
    let reject: (e: Error) => void = () => undefined;
    const commit = vi
      .fn<CommitFn>()
      .mockImplementationOnce(() => new Promise<void>((_, rej) => (reject = rej)))
      .mockResolvedValue(undefined);
    const { saver } = setup(commit);

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    await vi.advanceTimersByTimeAsync(2000); // flush 1 in flight

    saver.forgetBundle('content/events/a'); // discard begins
    reject(new Error('network')); // flush 1 fails → restores its snapshot
    await saver.settle();
    saver.forgetBundle('content/events/a'); // fence: forget the restored snapshot

    expect(saver.getDirtyObject('content/events/a/index.md')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60000);
    expect(commit).toHaveBeenCalledTimes(1); // nothing left to re-commit
  });

  it('saveNow() flushes immediately without waiting for the idle timer', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    await saver.saveNow();

    expect(commit).toHaveBeenCalledTimes(1);
  });
});

/**
 * Publish awaits saveNow() and only then plans against the WIP tip, so "resolved" has to
 * mean "on the branch". The old `if (flushing) return` resolved instantly while the
 * caller's edits sat in the dirty map — which is how a publish shipped the previous
 * version and left the change pending straight afterwards.
 */
describe('Autosaver.saveNow — resolves only once everything queued has landed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const A = 'content/events/a/index.md';

  it('awaits an in-flight flush instead of resolving straight past it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commit = vi.fn<CommitFn>(async () => {
      await gate;
    });
    const { saver } = setup(commit);

    saver.markObjectDirty(A, { title: 'A' }, 'body');
    void saver.saveNow(); // first flush, now stuck in commit

    let settled = false;
    const second = saver.saveNow().then((ok) => {
      settled = true;
      return ok;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false); // must not resolve while the commit is in flight

    release();
    await expect(second).resolves.toBe(true);
    expect(settled).toBe(true);
  });

  it('commits edits made while an earlier flush was in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commit = vi.fn<CommitFn>(async () => {
      await gate;
    });
    const { saver } = setup(commit);

    saver.markObjectDirty(A, { title: 'A' }, 'v1');
    void saver.saveNow(); // takes v1 and blocks in commit

    // A template edit typed a moment later — the flush already took its snapshot, so it
    // is NOT part of that commit and must go in a second one before saveNow resolves.
    saver.markFileDirty('themes/acme/assets/theme.css', 'body { color: red }');
    const pending = saver.saveNow();
    release();
    await expect(pending).resolves.toBe(true);

    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls[1]![0].map((f) => f.path)).toEqual(['themes/acme/assets/theme.css']);
  });

  it('resolves false when the flush failed, leaving the edits queued for the retry', async () => {
    const commit = vi.fn<CommitFn>().mockRejectedValue(new Error('network'));
    const { saver } = setup(commit);

    saver.markFileDirty('templates/default.liquid', 'v1');
    await expect(saver.saveNow()).resolves.toBe(false);
    expect(commit).toHaveBeenCalledTimes(1); // the backoff owns the retry, not saveNow
    expect(saver.getDirtyFile('templates/default.liquid')).toBe('v1');
  });

  it('resolves true when there was nothing to save', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    await expect(saver.saveNow()).resolves.toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });
});
