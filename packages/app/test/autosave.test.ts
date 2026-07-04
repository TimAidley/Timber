import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileWrite } from '@timber/github';
import { Autosaver, type SyncState } from '../src/state/autosave.js';

type CommitFn = (files: FileWrite[], message: string) => Promise<void>;

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

  it('saveNow() flushes immediately without waiting for the idle timer', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markObjectDirty('content/events/a/index.md', { title: 'A' }, 'body');
    await saver.saveNow();

    expect(commit).toHaveBeenCalledTimes(1);
  });
});
