import type { FrontMatter } from '@timber/generator';
import { DEFAULT_STORAGE, type StorageLevel } from './location.js';

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
  /**
   * Blob SHA of the branch copy this draft was started from, when there was one. It is
   * what lets load-time recovery tell "unsaved work" from "a draft the branch has since
   * moved past" — without it the two are identical in shape and the draft always wins,
   * which is how newer commits came to be silently overwritten. Absent for a draft with
   * no branch copy yet (a freshly created object) and for drafts written before this
   * was recorded; both are treated as fresh, since neither indicates a conflict.
   */
  baseSha?: string;
}

const DB_NAME = 'timber-drafts';
const STORE = 'drafts';
/**
 * Per-object **storage level** (SPEC §5/§8 storage axis), device-local metadata kept
 * next to the drafts. Only objects parked *On this device* get a record here — absence
 * means `backed-up` (the default), so this store is small and a normal object costs
 * nothing. Keyed by repo + path like the drafts.
 */
const STORAGE_STORE = 'storage';
/**
 * **Staged asset bytes** (SPEC §5/§8/§11), keyed by repo + path. Two populations share
 * this store, with different lifetimes:
 *
 * - A device-only object's colocated assets: this is their durable home — the object
 *   never commits, so without this they'd vanish on reload.
 * - Every other staged asset (a backed-up object's image, a site asset): a **crash
 *   safety net**, exactly like the text drafts. The bytes otherwise live only in the
 *   in-memory AssetStore until the debounced WIP commit lands — a reload in that
 *   window kept the recovered draft but lost its image. Dropped once the commit
 *   lands; re-staged and re-queued on load if it hadn't.
 */
const ASSET_STORE = 'assets';

function keyOf(repoKey: string, path: string): string {
  return `${repoKey}::${path}`;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'));
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
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
      // v2 adds the storage-level store; created on fresh installs and on upgrade.
      if (!db.objectStoreNames.contains(STORAGE_STORE)) {
        db.createObjectStore(STORAGE_STORE, { keyPath: 'key' });
      }
      // v3 adds the device-only asset store.
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: 'key' });
      }
      // v4 is a one-time eviction, not a schema change. Until this version drafts were
      // never dropped once their commit landed, so every browser that has run the editor
      // holds a pile of drafts for content long since on the branch — and load-time
      // recovery, which cannot tell a stale draft from unsaved work, re-queues any that
      // differ. That is a live data-loss path: it has already reverted a page's front
      // matter to its creation-time state and undone a template fix pushed from
      // elsewhere. The accumulated drafts are indistinguishable from good ones, so the
      // only safe move is to evict them all and let the branch — the durable copy (SPEC
      // §11: IndexedDB is a "don't lose the last few minutes" net, not the record) —
      // reseed. At worst an author loses seconds of typing that autosave hadn't yet
      // committed; leaving them costs arbitrarily old content silently overwriting new.
      //
      // Device-only objects are EXEMPT: their draft is not a cache, it is the only copy
      // (SPEC §5/§8), so evicting it would destroy content.
      if (event.oldVersion > 0 && event.oldVersion < 4) {
        const tx = request.transaction;
        if (tx) {
          const keep = new Set<string>();
          const storage = tx.objectStore(STORAGE_STORE).getAll() as IDBRequest<
            { key: string }[]
          >;
          storage.onsuccess = () => {
            for (const row of storage.result) keep.add(row.key);
            const drafts = tx.objectStore(STORE);
            const all = drafts.getAll() as IDBRequest<(LocalDraft & { key: string })[]>;
            all.onsuccess = () => {
              for (const draft of all.result) {
                if (!keep.has(draft.key)) drafts.delete(draft.key);
              }
            };
          };
        }
      }
    };
    // Not `promisify`: a version bump can't proceed while another tab still holds the
    // old version open, and in that case `open` neither succeeds nor errors — it fires
    // `blocked` and waits indefinitely. Unhandled, that hangs the caller forever: drafts
    // silently stop persisting, and the advanced panel (which awaits this before loading
    // anything) never opens at all. Reject with something the author can act on.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      request.onblocked = () =>
        reject(
          new Error(
            'another Timber tab is open on an older version — close it and reload this page',
          ),
        );
    });
    return new LocalDraftStore(db);
  }

  async put(
    repoKey: string,
    path: string,
    data: FrontMatter,
    body: string,
    baseSha?: string,
  ): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const draft: LocalDraft = { repoKey, path, data, body, updatedAt: Date.now() };
    if (baseSha !== undefined) draft.baseSha = baseSha;
    tx.objectStore(STORE).put({ key: keyOf(repoKey, path), ...draft });
    await txDone(tx);
  }

  /** All drafts for a repo (to reconcile against the loaded WIP content). */
  async allForRepo(repoKey: string): Promise<LocalDraft[]> {
    const tx = this.db.transaction(STORE, 'readonly');
    const all = await promisify<LocalDraft[]>(
      tx.objectStore(STORE).getAll() as IDBRequest<LocalDraft[]>,
    );
    return all.filter((d) => d.repoKey === repoKey);
  }

  async delete(repoKey: string, path: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(keyOf(repoKey, path));
    await txDone(tx);
  }

  /**
   * Drop a draft **only if it hasn't been touched since `since`** — the "its commit
   * landed" case. A draft is a crash net for work not yet on the branch, so once the WIP
   * commit carrying it succeeds it has done its job and must go: a draft that outlives
   * its commit is indistinguishable, on the next load, from genuinely unsaved work, and
   * {@link LocalDraftStore} has no way to tell which is newer. That is precisely how a
   * long-dead draft came to be re-queued over newer branch content.
   *
   * The timestamp guard closes the race the plain delete would open: the author keeps
   * typing while the commit is in flight, `put` writes a newer draft, and deleting
   * blindly would bin those keystrokes. A newer `updatedAt` means the draft has moved on
   * from what was committed, so it stays (and its own commit will clear it).
   */
  async deleteIfUnchangedSince(
    repoKey: string,
    path: string,
    since: number,
  ): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const key = keyOf(repoKey, path);
    const existing = await promisify<LocalDraft | undefined>(
      store.get(key) as IDBRequest<LocalDraft | undefined>,
    );
    if (existing && existing.updatedAt <= since) store.delete(key);
    await txDone(tx);
  }

  /**
   * Drop every draft for a repo except those whose sole copy is local (device-only
   * objects, SPEC §5/§8 — deleting those would destroy content, not a cache). Used after
   * a successful publish, when the branch has just become the agreed truth and any draft
   * still lying around can only be a stale shadow of it.
   */
  async clearBackedUp(repoKey: string): Promise<void> {
    const keep = await this.devicePaths(repoKey);
    const tx = this.db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const all = await promisify<LocalDraft[]>(store.getAll() as IDBRequest<LocalDraft[]>);
    for (const draft of all) {
      if (draft.repoKey !== repoKey || keep.has(draft.path)) continue;
      store.delete(keyOf(repoKey, draft.path));
    }
    await txDone(tx);
  }

  /**
   * Record an object's storage level (SPEC §5/§8). Writing `backed-up` — the default —
   * **removes** the record rather than storing it, so the store only ever holds the
   * exceptions (device-only objects) and `devicePaths` reads cleanly.
   */
  async setStorage(repoKey: string, path: string, level: StorageLevel): Promise<void> {
    const tx = this.db.transaction(STORAGE_STORE, 'readwrite');
    const store = tx.objectStore(STORAGE_STORE);
    if (level === DEFAULT_STORAGE) store.delete(keyOf(repoKey, path));
    else store.put({ key: keyOf(repoKey, path), repoKey, path, level });
    await txDone(tx);
  }

  /** The set of paths the user is keeping **on this device** for a repo (load-time merge). */
  async devicePaths(repoKey: string): Promise<Set<string>> {
    const tx = this.db.transaction(STORAGE_STORE, 'readonly');
    const all = await promisify<StorageRecord[]>(
      tx.objectStore(STORAGE_STORE).getAll() as IDBRequest<StorageRecord[]>,
    );
    return new Set(
      all.filter((r) => r.repoKey === repoKey && r.level === 'device').map((r) => r.path),
    );
  }

  /** Drop an object's storage-level record (on delete; `backed-up` needs none anyway). */
  async deleteStorage(repoKey: string, path: string): Promise<void> {
    const tx = this.db.transaction(STORAGE_STORE, 'readwrite');
    tx.objectStore(STORAGE_STORE).delete(keyOf(repoKey, path));
    await txDone(tx);
  }

  /**
   * Persist a device-only object's colocated asset (SPEC §5/§8) as raw bytes + MIME type
   * rather than a `Blob`: portable across environments and robust against browsers that
   * don't structured-clone `Blob` into IndexedDB. Callers pass bytes read from the staged
   * Blob (browser `Blob.arrayBuffer()`), so the store itself never touches a Blob.
   */
  async putAsset(
    repoKey: string,
    path: string,
    bytes: Uint8Array,
    type: string,
  ): Promise<void> {
    const tx = this.db.transaction(ASSET_STORE, 'readwrite');
    tx.objectStore(ASSET_STORE).put({
      key: keyOf(repoKey, path),
      repoKey,
      path,
      bytes,
      type,
    });
    await txDone(tx);
  }

  /** All locally-persisted device-only assets for a repo (re-staged into memory on load). */
  async allAssetsForRepo(repoKey: string): Promise<{ path: string; blob: Blob }[]> {
    const tx = this.db.transaction(ASSET_STORE, 'readonly');
    const all = await promisify<AssetRecord[]>(
      tx.objectStore(ASSET_STORE).getAll() as IDBRequest<AssetRecord[]>,
    );
    return all
      .filter((a) => a.repoKey === repoKey)
      .map((a) => ({
        path: a.path,
        blob: new Blob([new Uint8Array(a.bytes)], { type: a.type }),
      }));
  }

  /** Drop a persisted device-only asset (on delete, or after it's backed up to the branch). */
  async deleteAsset(repoKey: string, path: string): Promise<void> {
    const tx = this.db.transaction(ASSET_STORE, 'readwrite');
    tx.objectStore(ASSET_STORE).delete(keyOf(repoKey, path));
    await txDone(tx);
  }
}

interface StorageRecord {
  key: string;
  repoKey: string;
  path: string;
  level: StorageLevel;
}

interface AssetRecord {
  key: string;
  repoKey: string;
  path: string;
  bytes: Uint8Array;
  type: string;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}
