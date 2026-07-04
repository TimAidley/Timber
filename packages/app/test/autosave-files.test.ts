import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileWrite } from '@timber/github';
import { Autosaver } from '../src/state/autosave.js';

type CommitFn = (files: FileWrite[], message: string) => Promise<void>;

function setup(commit: CommitFn) {
  const saver = new Autosaver({
    commit,
    assetBytes: async () => undefined,
    onState: () => undefined,
    idleMs: 2000,
    retryMs: 5000,
  });
  return { saver };
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
