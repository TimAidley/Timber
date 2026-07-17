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
 * Colocated **asset bytes** for objects kept On this device (SPEC §5/§8). A device-only
 * object never commits to the branch, so its images have nowhere durable to live — they'd
 * vanish on reload. This store keeps their Blobs locally (keyed by repo + path) so they
 * survive a reload, and they're re-queued to the branch if the object is later backed up.
 * Only device-only bundles' assets land here; backed-up assets come from the branch.
 */
const ASSET_STORE = 'assets';

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
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
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
    return new Set(all.filter((r) => r.repoKey === repoKey && r.level === 'device').map((r) => r.path));
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
  async putAsset(repoKey: string, path: string, bytes: Uint8Array, type: string): Promise<void> {
    const tx = this.db.transaction(ASSET_STORE, 'readwrite');
    tx.objectStore(ASSET_STORE).put({ key: keyOf(repoKey, path), repoKey, path, bytes, type });
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
      .map((a) => ({ path: a.path, blob: new Blob([new Uint8Array(a.bytes)], { type: a.type }) }));
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
