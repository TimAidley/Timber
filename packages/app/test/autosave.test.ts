import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileWrite, MoveEntry } from '@timber/github';
import { Autosaver, type SyncState } from '../src/state/autosave.js';

type CommitFn = (files: FileWrite[], message: string, deletions: string[], moves: MoveEntry[]) => Promise<void>;

function setup(commit: CommitFn) {
  const states: SyncState[] = [];
  const saver = new Autosaver({
    commit,
    assetBytes: async (path) => (path.endsWith('.webp') ? new Uint8Array([1, 2, 3]) : undefined),
    onState: (s) => states.push(s),
    idleMs: 2000,
    retryMs: 5000,
  });
  return { saver, states };
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

  it('saveNow() flushes immediately without waiting for the idle timer', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    await saver.saveNow();

    expect(commit).toHaveBeenCalledTimes(1);
  });
});
