import { useEffect, useMemo, useState } from 'react';
import type { FileWrite } from '@timber/github';
import type { FrontMatter } from '@timber/generator';
import { reassembleDocument } from '../content/document.js';
import type { AssetStore } from './assets.js';
import type { RepoSession } from './repoSession.js';

export type SyncState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface DirtyObject {
  data: FrontMatter;
  body: string;
}

export interface AutosaverDeps {
  /** Land one coalesced commit of all dirty files on the WIP branch. */
  commit: (files: FileWrite[], message: string) => Promise<void>;
  /** Fetch a staged asset's bytes for committing. */
  assetBytes: (path: string) => Promise<Uint8Array | undefined>;
  /** Notified whenever the sync state changes (drives the indicator). */
  onState: (state: SyncState) => void;
  idleMs?: number;
  retryMs?: number;
}

function describeCommit(objectPaths: string[], filePaths: string[], assetPaths: string[]): string {
  const names = [
    ...objectPaths.map((p) => p.replace(/\/index\.md$/, '').split('/').pop() ?? p),
    ...filePaths, // templates/config commit under their full path
  ];
  const head =
    names.length === 1 ? `edit ${names[0]}` : names.length > 1 ? `edit ${names.length} items` : 'add assets';
  const assets = assetPaths.length ? ` (+${assetPaths.length} asset${assetPaths.length > 1 ? 's' : ''})` : '';
  return `${head}${assets}`;
}

/**
 * The debounced, coalesced commit orchestrator (SPEC §11), as a plain class so its
 * timing/coalescing logic is unit-testable without React. Edits accumulate in a
 * dirty map and flush as ONE commit ("edited the summer-fete event," not one per
 * file); on failure the dirty state is kept, the indicator goes to `error`, and it
 * retries with backoff. React binding is the thin {@link useAutosave} hook below.
 */
export class Autosaver {
  private dirtyObjects = new Map<string, DirtyObject>();
  private dirtyFiles = new Map<string, string>();
  private dirtyAssets = new Set<string>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private readonly idleMs: number;
  private readonly retryMs: number;

  constructor(private readonly deps: AutosaverDeps) {
    this.idleMs = deps.idleMs ?? 2000;
    this.retryMs = deps.retryMs ?? 5000;
  }

  markObjectDirty(path: string, data: FrontMatter, body: string): void {
    this.dirtyObjects.set(path, { data, body });
    this.deps.onState('dirty');
    this.schedule();
  }

  /**
   * Mark a raw text file (a template or config YAML) dirty (SPEC §8 advanced area).
   * Unlike objects, these carry no front matter/body — just the file's full text —
   * and commit under their own path. The advanced area only calls this once the file
   * *validates*, so a broken template never enters the coalesced WIP commit.
   */
  markFileDirty(path: string, content: string): void {
    this.dirtyFiles.set(path, content);
    this.deps.onState('dirty');
    this.schedule();
  }

  markAssetDirty(path: string): void {
    this.dirtyAssets.add(path);
    this.deps.onState('dirty');
    this.schedule();
  }

  getDirtyObject(path: string): DirtyObject | undefined {
    return this.dirtyObjects.get(path);
  }

  getDirtyFile(path: string): string | undefined {
    return this.dirtyFiles.get(path);
  }

  /** Flush immediately (explicit save / tab hide). */
  saveNow(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    return this.flush();
  }

  private schedule(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.flush(), this.idleMs);
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.dirtyObjects.size === 0 && this.dirtyFiles.size === 0 && this.dirtyAssets.size === 0) return;

    // Optimistically take the dirty set; restore it on failure.
    const objects = [...this.dirtyObjects.entries()];
    const rawFiles = [...this.dirtyFiles.entries()];
    const assets = [...this.dirtyAssets];
    this.dirtyObjects = new Map();
    this.dirtyFiles = new Map();
    this.dirtyAssets = new Set();

    this.flushing = true;
    this.deps.onState('saving');
    try {
      const assetFiles = await Promise.all(
        assets.map(async (path): Promise<FileWrite | null> => {
          const bytes = await this.deps.assetBytes(path);
          return bytes ? { path, bytes } : null;
        }),
      );
      const files: FileWrite[] = [
        ...objects.map(([path, o]): FileWrite => ({ path, content: reassembleDocument(o.data, o.body) })),
        ...rawFiles.map(([path, content]): FileWrite => ({ path, content })),
        ...assetFiles.filter((f): f is FileWrite => f !== null),
      ];

      await this.deps.commit(
        files,
        describeCommit(objects.map(([p]) => p), rawFiles.map(([p]) => p), assets),
      );
      const stillDirty = this.dirtyObjects.size || this.dirtyFiles.size || this.dirtyAssets.size;
      this.deps.onState(stillDirty ? 'dirty' : 'saved');
    } catch {
      for (const [path, o] of objects) if (!this.dirtyObjects.has(path)) this.dirtyObjects.set(path, o);
      for (const [path, content] of rawFiles) if (!this.dirtyFiles.has(path)) this.dirtyFiles.set(path, content);
      for (const path of assets) this.dirtyAssets.add(path);
      this.deps.onState('error');
      setTimeout(() => void this.flush(), this.retryMs);
    } finally {
      this.flushing = false;
    }
  }
}

export interface Autosave {
  syncState: SyncState;
  markObjectDirty: (path: string, data: FrontMatter, body: string) => void;
  markFileDirty: (path: string, content: string) => void;
  markAssetDirty: (path: string) => void;
  getDirtyObject: (path: string) => DirtyObject | undefined;
  getDirtyFile: (path: string) => string | undefined;
  saveNow: () => void;
}

/** React binding for {@link Autosaver}: commits dirty edits to the session's WIP branch. */
export function useAutosave(session: RepoSession, assetStore: AssetStore): Autosave {
  const [syncState, setSyncState] = useState<SyncState>('idle');

  const saver = useMemo(
    () =>
      new Autosaver({
        commit: async (files, message) => {
          await session.client.commitFiles({
            branch: session.wipBranch,
            baseBranch: session.defaultBranch,
            message,
            files,
          });
        },
        assetBytes: (path) => assetStore.bytes(path),
        onState: setSyncState,
      }),
    [session, assetStore],
  );

  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') void saver.saveNow();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [saver]);

  return {
    syncState,
    markObjectDirty: (path, data, body) => saver.markObjectDirty(path, data, body),
    markFileDirty: (path, content) => saver.markFileDirty(path, content),
    markAssetDirty: (path) => saver.markAssetDirty(path),
    getDirtyObject: (path) => saver.getDirtyObject(path),
    getDirtyFile: (path) => saver.getDirtyFile(path),
    saveNow: () => void saver.saveNow(),
  };
}
