import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalDraftStore } from '../src/state/localDraft.js';

/**
 * The device-local safety net (SPEC §11): drafts must survive a reload/crash before
 * the WIP commit lands, and must be scoped per repo so they never bleed across sites.
 */
describe('LocalDraftStore', () => {
  it('persists and retrieves drafts scoped by repo', async () => {
    const store = await LocalDraftStore.open();
    await store.put('owner/repo', 'content/a/index.md', { title: 'A' }, 'body a');
    await store.put('owner/repo', 'content/b/index.md', { title: 'B' }, 'body b');
    await store.put('other/repo', 'content/x/index.md', { title: 'X' }, 'x');

    const drafts = await store.allForRepo('owner/repo');
    expect(drafts.map((d) => d.path).sort()).toEqual([
      'content/a/index.md',
      'content/b/index.md',
    ]);
    const a = drafts.find((d) => d.path === 'content/a/index.md');
    expect(a?.body).toBe('body a');
    expect(a?.data).toEqual({ title: 'A' });
  });

  it('survives reopening the database (crash recovery)', async () => {
    const first = await LocalDraftStore.open();
    await first.put('recovery/repo', 'content/c/index.md', { title: 'C' }, 'unsaved body');

    const reopened = await LocalDraftStore.open();
    const drafts = await reopened.allForRepo('recovery/repo');
    expect(drafts.find((d) => d.path === 'content/c/index.md')?.body).toBe('unsaved body');
  });

  it('deletes a draft once it is committed', async () => {
    const store = await LocalDraftStore.open();
    await store.put('del/repo', 'content/d/index.md', {}, 'x');
    await store.delete('del/repo', 'content/d/index.md');
    expect(await store.allForRepo('del/repo')).toHaveLength(0);
  });
});
