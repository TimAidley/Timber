import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileWrite, MoveEntry } from '@timber/host';
import { Autosaver, type SyncState } from '../src/state/autosave.js';

type CommitFn = (files: FileWrite[], message: string, deletions: string[], moves: MoveEntry[]) => Promise<void>;

const BACKED = 'content/events/a/index.md';
const DEVICE = 'content/events/secret/index.md';

function setup(commit: CommitFn, deviceOnly: ReadonlySet<string>) {
  const states: SyncState[] = [];
  const saver = new Autosaver({
    commit,
    assetBytes: async () => undefined,
    onState: (s) => states.push(s),
    isDeviceOnly: (path) => deviceOnly.has(path),
    idleMs: 2000,
  });
  return { saver, states };
}

describe('Autosaver device-only filter (SPEC §5/§8)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits backed-up objects but never a device-only one', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit, new Set([DEVICE]));

    saver.markObjectDirty(BACKED, { title: 'A' }, 'a');
    saver.markObjectDirty(DEVICE, { title: 'Secret' }, 's');
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    const [files] = commit.mock.calls[0]!;
    expect(files.map((f) => f.path)).toEqual([BACKED]);
  });

  it('makes no commit at all when only device-only objects are dirty', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver, states } = setup(commit, new Set([DEVICE]));

    saver.markObjectDirty(DEVICE, { title: 'Secret' }, 's');
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).not.toHaveBeenCalled();
    // …and it settles to idle rather than hanging in "saving" or making an empty commit.
    expect(states.at(-1)).toBe('idle');
  });

  it('commits an object once it is promoted from device-only (predicate flips)', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    // The predicate reads a live set — exactly how the editor's "Back up to the repo"
    // action works: it clears the device flag, then re-queues the object's content.
    const deviceOnly = new Set<string>([DEVICE]);
    const saver = new Autosaver({
      commit,
      assetBytes: async () => undefined,
      onState: () => undefined,
      isDeviceOnly: (path) => deviceOnly.has(path),
      idleMs: 2000,
    });

    deviceOnly.delete(DEVICE); // promote
    saver.markObjectDirty(DEVICE, { title: 'Secret' }, 's');
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]![0].map((f) => f.path)).toEqual([DEVICE]);
  });
});
