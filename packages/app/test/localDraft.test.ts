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
    await first.put(
      'recovery/repo',
      'content/c/index.md',
      { title: 'C' },
      'unsaved body',
    );

    const reopened = await LocalDraftStore.open();
    const drafts = await reopened.allForRepo('recovery/repo');
    expect(drafts.find((d) => d.path === 'content/c/index.md')?.body).toBe(
      'unsaved body',
    );
  });

  it('deletes a draft once it is committed', async () => {
    const store = await LocalDraftStore.open();
    await store.put('del/repo', 'content/d/index.md', {}, 'x');
    await store.delete('del/repo', 'content/d/index.md');
    expect(await store.allForRepo('del/repo')).toHaveLength(0);
  });
});

/**
 * Draft lifetime (the data-loss fix). A draft is a crash net for work not yet on the
 * branch; kept past its commit it becomes indistinguishable, at load time, from unsaved
 * work and gets re-queued over newer branch content. These cover the two ends it is now
 * dropped at, and the two things that must survive.
 */
describe('LocalDraftStore — dropping spent drafts', () => {
  it('drops a draft whose commit has landed', async () => {
    const store = await LocalDraftStore.open();
    await store.put('spent/repo', 'content/a/index.md', { title: 'A' }, 'committed');
    const landedAfter = Date.now() + 1000;

    await store.deleteIfUnchangedSince('spent/repo', 'content/a/index.md', landedAfter);

    expect(await store.allForRepo('spent/repo')).toEqual([]);
  });

  it('keeps a draft the author touched while the commit was in flight', async () => {
    const store = await LocalDraftStore.open();
    // The flush stamps `takenAt`, then the author keeps typing — that newer draft holds
    // keystrokes the in-flight commit never carried, so it must survive.
    const takenAt = Date.now() - 1000;
    await store.put(
      'race/repo',
      'content/a/index.md',
      { title: 'A' },
      'typed during commit',
    );

    await store.deleteIfUnchangedSince('race/repo', 'content/a/index.md', takenAt);

    const drafts = await store.allForRepo('race/repo');
    expect(drafts.map((d) => d.body)).toEqual(['typed during commit']);
  });

  it('clears backed-up drafts on publish but never a device-only one', async () => {
    const store = await LocalDraftStore.open();
    await store.put(
      'pub/repo',
      'content/backed/index.md',
      { title: 'B' },
      'on the branch',
    );
    await store.put('pub/repo', 'content/local/index.md', { title: 'L' }, 'only copy');
    await store.put(
      'elsewhere/repo',
      'content/keep/index.md',
      { title: 'K' },
      'another site',
    );
    await store.setStorage('pub/repo', 'content/local/index.md', 'device');

    await store.clearBackedUp('pub/repo');

    // The device-only object's draft IS its durable copy — clearing it destroys content.
    expect((await store.allForRepo('pub/repo')).map((d) => d.path)).toEqual([
      'content/local/index.md',
    ]);
    // Another repo's drafts are none of this publish's business.
    expect((await store.allForRepo('elsewhere/repo')).map((d) => d.path)).toEqual([
      'content/keep/index.md',
    ]);
  });
});
