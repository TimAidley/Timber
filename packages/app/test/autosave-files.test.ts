import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileWrite, MoveEntry } from '@timber/github';
import { Autosaver } from '../src/state/autosave.js';

type CommitFn = (files: FileWrite[], message: string, deletions: string[], moves: MoveEntry[]) => Promise<void>;

function setup(commit: CommitFn) {
  const dirtyPathSets: string[][] = [];
  const saver = new Autosaver({
    commit,
    assetBytes: async () => undefined,
    onState: () => undefined,
    onDirtyPaths: (paths) => dirtyPathSets.push([...paths].sort()),
    idleMs: 2000,
    retryMs: 5000,
  });
  return { saver, dirtyPathSets };
}

describe('Autosaver.markFileDirty (advanced area — templates/config)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits a raw file as a text FileWrite under its own path', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markFileDirty('templates/default.liquid', '<h1>{{ page.title }}</h1>');
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    const [files, message] = commit.mock.calls[0]!;
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({ path: 'templates/default.liquid', content: '<h1>{{ page.title }}</h1>' });
    expect(message).toBe('edit templates/default.liquid');
  });

  it('coalesces a content edit and a template edit into ONE commit', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markObjectDirty('content/pages/hello/index.md', { title: 'Hello' }, 'body');
    saver.markFileDirty('config/navigation.yml', '- label: Home\n  ref: home\n');
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    const [files, message] = commit.mock.calls[0]!;
    expect(files.map((f) => f.path).sort()).toEqual([
      'config/navigation.yml',
      'content/pages/hello/index.md',
    ]);
    expect(message).toBe('edit 2 items');
  });

  it('debounces rapid edits to the same file (latest wins)', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markFileDirty('templates/default.liquid', 'v1');
    await vi.advanceTimersByTimeAsync(500);
    saver.markFileDirty('templates/default.liquid', 'v2');
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    const [files] = commit.mock.calls[0]!;
    expect(files).toHaveLength(1);
    expect('content' in files[0]! && files[0]!.content).toBe('v2');
  });

  it('exposes the pending file text via getDirtyFile', () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markFileDirty('templates/default.liquid', 'draft');
    expect(saver.getDirtyFile('templates/default.liquid')).toBe('draft');
    expect(saver.getDirtyFile('templates/missing.liquid')).toBeUndefined();
  });

  // The advanced area's edits were left out of the "editing" set entirely, so a template
  // or stylesheet edit showed nothing in the header until its commit landed ~5s later.
  it('reports an edited file as editing until its commit lands', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver, dirtyPathSets } = setup(commit);

    saver.markFileDirty('themes/acme/assets/theme.css', 'body { color: red }');
    expect(dirtyPathSets.at(-1)).toEqual(['themes/acme/assets/theme.css']);

    await vi.advanceTimersByTimeAsync(2000);
    expect(dirtyPathSets.at(-1)).toEqual([]); // on the branch → "saved", not "editing"
  });

  it('keeps a file in the editing set while a failing commit retries', async () => {
    const commit = vi
      .fn<CommitFn>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const { saver, dirtyPathSets } = setup(commit);

    saver.markFileDirty('templates/default.liquid', 'v1');
    await vi.advanceTimersByTimeAsync(2000); // attempt 1 fails
    expect(dirtyPathSets.at(-1)).toEqual(['templates/default.liquid']);

    await vi.advanceTimersByTimeAsync(5000); // backoff retry succeeds
    expect(dirtyPathSets.at(-1)).toEqual([]);
  });

  it('forgetFile drops the file from the editing set (revert)', () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver, dirtyPathSets } = setup(commit);

    saver.markFileDirty('templates/default.liquid', 'v1');
    saver.forgetFile('templates/default.liquid');
    expect(dirtyPathSets.at(-1)).toEqual([]);
  });

  it('keeps the file dirty and retries after a failed commit', async () => {
    const commit = vi
      .fn<CommitFn>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const { saver } = setup(commit);

    saver.markFileDirty('templates/default.liquid', 'v1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(commit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(commit).toHaveBeenCalledTimes(2);
    const [files] = commit.mock.calls[1]!;
    expect(files[0]!.path).toBe('templates/default.liquid');
  });
});

describe('Autosaver delete / restore (SPEC §5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const INDEX = 'content/events/gone/index.md';
  const ASSET = 'content/events/gone/hero.webp';

  it('markObjectRestored cancels a pending deletion before it commits', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    // Delete the whole bundle, then restore it before the debounce fires.
    saver.markPathsDeleted([INDEX, ASSET]);
    saver.markObjectRestored(INDEX, { title: 'Gone' }, 'body', [{ from: ASSET, to: ASSET, sha: 'ASSET' }]);
    await vi.advanceTimersByTimeAsync(2000);

    expect(commit).toHaveBeenCalledTimes(1);
    const [files, message, deletions, moves] = commit.mock.calls[0]!;
    // No deletion survives; the bundle is re-added (index.md write + self-move asset).
    expect(deletions).toEqual([]);
    expect(files.map((f) => f.path)).toEqual([INDEX]);
    expect(moves).toEqual([{ from: ASSET, to: ASSET, sha: 'ASSET' }]);
    expect(message).toContain('edit');
  });

  it('forgetBundle drops a bundle’s pending edits without committing (discard)', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    saver.markObjectDirty(INDEX, { title: 'Gone' }, 'edited');
    saver.markAssetDirty(ASSET);
    saver.markObjectDirty('content/events/kept/index.md', { title: 'Kept' }, 'body'); // another bundle

    saver.forgetBundle('content/events/gone');
    await vi.advanceTimersByTimeAsync(2000);

    // Only the other bundle flushes; the forgotten bundle contributes nothing.
    expect(commit).toHaveBeenCalledTimes(1);
    const [files] = commit.mock.calls[0]!;
    expect(files.map((f) => f.path)).toEqual(['content/events/kept/index.md']);
  });

  it('markObjectRestored re-adds a bundle whose deletion already committed', async () => {
    const commit = vi.fn<CommitFn>(async () => undefined);
    const { saver } = setup(commit);

    // First flush: the deletion lands on WIP.
    saver.markPathsDeleted([INDEX, ASSET]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]![2]).toEqual([INDEX, ASSET]); // deletions

    // Restore: a second flush re-adds index.md + re-attaches the asset by SHA.
    saver.markObjectRestored(INDEX, { title: 'Gone' }, 'body', [{ from: ASSET, to: ASSET, sha: 'ASSET' }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(commit).toHaveBeenCalledTimes(2);
    const [files, , deletions, moves] = commit.mock.calls[1]!;
    expect(files.map((f) => f.path)).toEqual([INDEX]);
    expect(deletions).toEqual([]);
    expect(moves).toEqual([{ from: ASSET, to: ASSET, sha: 'ASSET' }]);
  });
});
