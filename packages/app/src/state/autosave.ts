import { useEffect, useMemo, useState } from 'react';
import type { FileWrite, MoveEntry } from '@timber/github';
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
  /** Land one coalesced commit of all dirty files (writes, deletions, moves) on the WIP branch. */
  commit: (files: FileWrite[], message: string, deletions: string[], moves: MoveEntry[]) => Promise<void>;
  /** Fetch a staged asset's bytes for committing. */
  assetBytes: (path: string) => Promise<Uint8Array | undefined>;
  /** Notified whenever the sync state changes (drives the indicator). */
  onState: (state: SyncState) => void;
  idleMs?: number;
  retryMs?: number;
}

/** A bundle name from an index.md path, e.g. `content/events/fete/index.md` → `fete`. */
function bundleName(path: string): string {
  return path.replace(/\/index\.md$/, '').split('/').pop() ?? path;
}

function describeCommit(
  objectPaths: string[],
  filePaths: string[],
  assetPaths: string[],
  deletedBundles: string[],
  renamedBundles: string[],
): string {
  const edits = [
    ...objectPaths.map(bundleName),
    ...filePaths, // templates/config commit under their full path
  ];
  const clauses: string[] = [];
  if (edits.length === 1) clauses.push(`edit ${edits[0]}`);
  else if (edits.length > 1) clauses.push(`edit ${edits.length} items`);
  if (renamedBundles.length === 1) clauses.push(`rename ${renamedBundles[0]}`);
  else if (renamedBundles.length > 1) clauses.push(`rename ${renamedBundles.length} items`);
  if (deletedBundles.length === 1) clauses.push(`delete ${deletedBundles[0]}`);
  else if (deletedBundles.length > 1) clauses.push(`delete ${deletedBundles.length} items`);
  const head = clauses.length ? clauses.join(', ') : 'add assets';
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
  private dirtyDeletions = new Set<string>();
  private dirtyMoves = new Map<string, MoveEntry>();
  /** New index.md path → old index.md path, for a clean "rename …" commit summary. */
  private dirtyRenames = new Map<string, string>();
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

  /**
   * Mark repo paths for removal in the next coalesced commit (SPEC §5 delete/rename).
   * Any pending edits to those exact paths are dropped — a deletion supersedes them.
   * Pass every file in a bundle (index.md + colocated assets) to remove an object.
   */
  markPathsDeleted(paths: string[]): void {
    for (const path of paths) {
      this.dirtyDeletions.add(path);
      this.dirtyObjects.delete(path);
      this.dirtyFiles.delete(path);
      this.dirtyAssets.delete(path);
    }
    this.deps.onState('dirty');
    this.schedule();
  }

  /**
   * Rename/move an object's bundle (SPEC §5). The `index.md` is rewritten at the new
   * path (its content changes — an alias is appended), the old `index.md` is deleted,
   * and colocated assets move by **reusing their blob SHAs** (no re-upload). All land
   * in the next coalesced WIP commit, summarised as "rename …".
   */
  markObjectRenamed(oldPath: string, newPath: string, data: FrontMatter, body: string, moves: MoveEntry[]): void {
    this.dirtyObjects.delete(oldPath);
    this.dirtyObjects.set(newPath, { data, body });
    this.dirtyDeletions.add(oldPath);
    for (const move of moves) this.dirtyMoves.set(move.to, move);
    this.dirtyRenames.set(newPath, oldPath);
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
    if (
      this.dirtyObjects.size === 0 &&
      this.dirtyFiles.size === 0 &&
      this.dirtyAssets.size === 0 &&
      this.dirtyDeletions.size === 0 &&
      this.dirtyMoves.size === 0
    )
      return;

    // Optimistically take the dirty set; restore it on failure.
    const objects = [...this.dirtyObjects.entries()];
    const rawFiles = [...this.dirtyFiles.entries()];
    const assets = [...this.dirtyAssets];
    const deletions = [...this.dirtyDeletions];
    const moves = [...this.dirtyMoves.values()];
    const renames = new Map(this.dirtyRenames);
    this.dirtyObjects = new Map();
    this.dirtyFiles = new Map();
    this.dirtyAssets = new Set();
    this.dirtyDeletions = new Set();
    this.dirtyMoves = new Map();
    this.dirtyRenames = new Map();

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

      // Split renames out of the edit/delete counts so the summary reads cleanly
      // ("rename fete" rather than "edit new, delete old").
      const renamedNewPaths = new Set(renames.keys());
      const renamedOldPaths = new Set(renames.values());
      const editPaths = objects.map(([p]) => p).filter((p) => !renamedNewPaths.has(p));
      const renamedBundles = [...renamedNewPaths].map(bundleName);
      const deletedBundles = deletions
        .filter((p) => p.endsWith('/index.md') && !renamedOldPaths.has(p))
        .map(bundleName);
      await this.deps.commit(
        files,
        describeCommit(editPaths, rawFiles.map(([p]) => p), assets, deletedBundles, renamedBundles),
        deletions,
        moves,
      );
      const stillDirty =
        this.dirtyObjects.size ||
        this.dirtyFiles.size ||
        this.dirtyAssets.size ||
        this.dirtyDeletions.size ||
        this.dirtyMoves.size;
      this.deps.onState(stillDirty ? 'dirty' : 'saved');
    } catch {
      for (const [path, o] of objects) if (!this.dirtyObjects.has(path)) this.dirtyObjects.set(path, o);
      for (const [path, content] of rawFiles) if (!this.dirtyFiles.has(path)) this.dirtyFiles.set(path, content);
      for (const path of assets) this.dirtyAssets.add(path);
      for (const path of deletions) this.dirtyDeletions.add(path);
      for (const move of moves) if (!this.dirtyMoves.has(move.to)) this.dirtyMoves.set(move.to, move);
      for (const [newP, oldP] of renames) if (!this.dirtyRenames.has(newP)) this.dirtyRenames.set(newP, oldP);
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
  markPathsDeleted: (paths: string[]) => void;
  markObjectRenamed: (oldPath: string, newPath: string, data: FrontMatter, body: string, moves: MoveEntry[]) => void;
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
        commit: async (files, message, deletions, moves) => {
          await session.client.commitFiles({
            branch: session.wipBranch,
            baseBranch: session.defaultBranch,
            message,
            files,
            deletions,
            moves,
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
    markPathsDeleted: (paths) => saver.markPathsDeleted(paths),
    markObjectRenamed: (oldPath, newPath, data, body, moves) =>
      saver.markObjectRenamed(oldPath, newPath, data, body, moves),
    getDirtyObject: (path) => saver.getDirtyObject(path),
    getDirtyFile: (path) => saver.getDirtyFile(path),
    saveNow: () => void saver.saveNow(),
  };
}
