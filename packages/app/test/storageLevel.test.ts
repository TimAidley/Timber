import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalDraftStore } from '../src/state/localDraft.js';

/**
 * The storage-level store (SPEC §5/§8 storage axis): only device-only objects get a
 * record; backed-up is the default and stores nothing, so `devicePaths` reads cleanly
 * and survives reloads (a device-only object's level must persist like its draft).
 */
describe('LocalDraftStore storage levels', () => {
  it('records device-only paths, scoped per repo', async () => {
    const store = await LocalDraftStore.open();
    await store.setStorage('s/repo', 'content/a/index.md', 'device');
    await store.setStorage('s/repo', 'content/b/index.md', 'backed-up');
    await store.setStorage('other/repo', 'content/c/index.md', 'device');

    expect([...(await store.devicePaths('s/repo'))]).toEqual(['content/a/index.md']);
    expect([...(await store.devicePaths('other/repo'))]).toEqual(['content/c/index.md']);
  });

  it('treats backed-up as the default by storing no record', async () => {
    const store = await LocalDraftStore.open();
    await store.setStorage('d/repo', 'content/x/index.md', 'device');
    expect(await store.devicePaths('d/repo')).toEqual(new Set(['content/x/index.md']));

    // Promoting to backed-up removes the record — the object rejoins the default.
    await store.setStorage('d/repo', 'content/x/index.md', 'backed-up');
    expect(await store.devicePaths('d/repo')).toEqual(new Set());
  });

  it('persists device-only levels across a reopen (crash recovery)', async () => {
    const first = await LocalDraftStore.open();
    await first.setStorage('r/repo', 'content/keep/index.md', 'device');

    const reopened = await LocalDraftStore.open();
    expect(await reopened.devicePaths('r/repo')).toEqual(new Set(['content/keep/index.md']));
  });

  it('drops the record on deleteStorage', async () => {
    const store = await LocalDraftStore.open();
    await store.setStorage('x/repo', 'content/g/index.md', 'device');
    await store.deleteStorage('x/repo', 'content/g/index.md');
    expect(await store.devicePaths('x/repo')).toEqual(new Set());
  });
});
