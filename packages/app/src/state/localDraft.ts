import type { FrontMatter } from '@timber/generator';

/**
 * A locally-persisted draft of one object's in-progress edit (SPEC §11's IndexedDB
 * layer: "don't lose the last few minutes"). Keyed by repo + path so drafts never
 * bleed across repos.
 */
export interface LocalDraft {
  repoKey: string;
  path: string;
  data: FrontMatter;
  body: string;
  updatedAt: number;
}

const DB_NAME = 'timber-drafts';
const STORE = 'drafts';

function keyOf(repoKey: string, path: string): string {
  return `${repoKey}::${path}`;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * IndexedDB-backed store for local drafts — the device-local safety net that
 * survives a crash/reload before the debounced WIP commit lands. Deliberately thin:
 * put on every edit, read + reconcile on load; the WIP branch remains the durable,
 * portable copy.
 */
export class LocalDraftStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<LocalDraftStore> {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    const db = await promisify(request);
    return new LocalDraftStore(db);
  }

  async put(repoKey: string, path: string, data: FrontMatter, body: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const draft: LocalDraft = { repoKey, path, data, body, updatedAt: Date.now() };
    tx.objectStore(STORE).put({ key: keyOf(repoKey, path), ...draft });
    await txDone(tx);
  }

  /** All drafts for a repo (to reconcile against the loaded WIP content). */
  async allForRepo(repoKey: string): Promise<LocalDraft[]> {
    const tx = this.db.transaction(STORE, 'readonly');
    const all = await promisify<LocalDraft[]>(tx.objectStore(STORE).getAll() as IDBRequest<LocalDraft[]>);
    return all.filter((d) => d.repoKey === repoKey);
  }

  async delete(repoKey: string, path: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(keyOf(repoKey, path));
    await txDone(tx);
  }
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}
