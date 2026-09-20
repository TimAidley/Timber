import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalDraftStore } from '../src/state/localDraft.js';

/** Write a pre-v4 database directly, the way earlier builds left it on disk. */
function seedV3(
  rows: { key: string; repoKey: string; path: string; body: string }[],
  device: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('timber-drafts', 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('drafts', { keyPath: 'key' });
      db.createObjectStore('storage', { keyPath: 'key' });
      db.createObjectStore('assets', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['drafts', 'storage'], 'readwrite');
      for (const r of rows)
        tx.objectStore('drafts').put({ ...r, data: {}, updatedAt: 1 });
      for (const k of device) tx.objectStore('storage').put({ key: k, level: 'device' });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * The one-time eviction. Until v4 a draft was never dropped once its commit landed, so
 * existing browsers hold a pile of drafts for content long since on the branch — and
 * load-time recovery re-queues any that differ, silently overwriting newer work. They
 * can't be told apart from good drafts, so the upgrade clears them and lets the branch
 * reseed. Device-only objects are the exception: their draft is the only copy.
 */
describe('LocalDraftStore — v4 upgrade evicts stale drafts', () => {
  it('drops backed-up drafts and keeps device-only ones', async () => {
    await seedV3(
      [
        {
          key: 'o/r::content/posts/stale/index.md',
          repoKey: 'o/r',
          path: 'content/posts/stale/index.md',
          body: 'months old',
        },
        {
          key: 'o/r::themes/anatole/templates/projects.liquid',
          repoKey: 'o/r',
          path: 'themes/anatole/templates/projects.liquid',
          body: 'pre-fix template',
        },
        {
          key: 'o/r::content/posts/local/index.md',
          repoKey: 'o/r',
          path: 'content/posts/local/index.md',
          body: 'only copy',
        },
      ],
      ['o/r::content/posts/local/index.md'],
    );

    const store = await LocalDraftStore.open();

    expect((await store.allForRepo('o/r')).map((d) => d.path)).toEqual([
      'content/posts/local/index.md',
    ]);
  });
});
