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
  /**
   * Notified whenever the set of objects with **local-only** (uncommitted) edits
   * changes — drives the per-item "Editing" badges + header count. Paths in flight
   * (being committed) stay included until the commit lands, so the badge doesn't
   * flicker to clean mid-save.
   */
  onDirtyObjects?: (paths: string[]) => void;
  /** Notified on a failed flush (before the backoff retry) — surfaces the cause. */
  onError?: (error: unknown) => void;
  idleMs?: number;
  retryMs?: number;
  /** Cap for the exponential retry backoff (default 60s). */
  maxRetryMs?: number;
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
  /** Object paths taken by an in-flight flush; kept in the "editing" set until it lands. */
  private flushingObjects = new Set<string>();
  private dirtyFiles = new Map<string, string>();
  private dirtyAssets = new Set<string>();
  private dirtyDeletions = new Set<string>();
  private dirtyMoves = new Map<string, MoveEntry>();
  /** New index.md path → old index.md path, for a clean "rename …" commit summary. */
  private dirtyRenames = new Map<string, string>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  /** Consecutive failed flushes; drives exponential retry backoff, reset on success. */
  private failures = 0;
  private readonly idleMs: number;
  private readonly retryMs: number;
  private readonly maxRetryMs: number;

  constructor(private readonly deps: AutosaverDeps) {
    this.idleMs = deps.idleMs ?? 5000; // SPEC §11: ~5–15s idle, not per-keystroke
    this.retryMs = deps.retryMs ?? 5000;
    this.maxRetryMs = deps.maxRetryMs ?? 60000;
  }

  /** Emit the current "editing" object set (uncommitted edits + in-flight). */
  private notifyDirtyObjects(): void {
    this.deps.onDirtyObjects?.([...new Set([...this.dirtyObjects.keys(), ...this.flushingObjects])]);
  }

  markObjectDirty(path: string, data: FrontMatter, body: string): void {
    this.dirtyObjects.set(path, { data, body });
    this.notifyDirtyObjects();
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
    this.notifyDirtyObjects();
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
    this.notifyDirtyObjects();
    this.deps.onState('dirty');
    this.schedule();
  }

  /**
   * Undo a pending/committed delete (SPEC §5 restore). Cancels any pending deletions
   * for the bundle, then re-adds it: rewrites `index.md` and re-attaches colocated
   * assets by **reusing their blob SHAs** (self-moves — `from === to`, so no deletion).
   * Uniform whether or not the delete already reached WIP; if it hadn't flushed yet the
   * rewrite is identical to the branch (a harmless no-op the publish squash collapses).
   */
  markObjectRestored(path: string, data: FrontMatter, body: string, moves: MoveEntry[]): void {
    const bundleDir = path.replace(/\/index\.md$/, '') + '/';
    for (const p of [...this.dirtyDeletions]) {
      if (p === path || p.startsWith(bundleDir)) this.dirtyDeletions.delete(p);
    }
    this.dirtyObjects.set(path, { data, body });
    for (const move of moves) this.dirtyMoves.set(move.to, move);
    this.notifyDirtyObjects();
    this.deps.onState('dirty');
    this.schedule();
  }

  /**
   * Drop all pending local state for a bundle without committing anything (SPEC §5
   * discard). Used when reverting a page to its published version: the reset itself is
   * a direct commit, so any queued edits/assets/deletions/moves for the bundle must be
   * forgotten first or the next flush would re-commit the very changes we discarded.
   */
  forgetBundle(bundleDir: string): void {
    const pref = `${bundleDir}/`;
    const inBundle = (p: string): boolean => p.startsWith(pref);
    for (const p of [...this.dirtyObjects.keys()]) if (inBundle(p)) this.dirtyObjects.delete(p);
    for (const p of [...this.dirtyFiles.keys()]) if (inBundle(p)) this.dirtyFiles.delete(p);
    for (const p of [...this.dirtyAssets]) if (inBundle(p)) this.dirtyAssets.delete(p);
    for (const p of [...this.dirtyDeletions]) if (inBundle(p)) this.dirtyDeletions.delete(p);
    for (const p of [...this.dirtyMoves.keys()]) if (inBundle(p)) this.dirtyMoves.delete(p);
    for (const p of [...this.dirtyRenames.keys()]) if (inBundle(p)) this.dirtyRenames.delete(p);
    this.notifyDirtyObjects();
    const anyDirty =
      this.dirtyObjects.size ||
      this.dirtyFiles.size ||
      this.dirtyAssets.size ||
      this.dirtyDeletions.size ||
      this.dirtyMoves.size;
    if (!anyDirty) this.deps.onState('idle');
  }

  /**
   * Drop a single raw file's pending edit without committing (SPEC §8 revert). The
   * advanced-area counterpart to {@link forgetBundle}: when reverting a template/config
   * file that was only edited **locally** (never saved to WIP), forget the queued edit
   * so the next flush doesn't re-commit what we just reverted.
   */
  forgetFile(path: string): void {
    this.dirtyFiles.delete(path);
    this.dirtyDeletions.delete(path);
    const anyDirty =
      this.dirtyObjects.size ||
      this.dirtyFiles.size ||
      this.dirtyAssets.size ||
      this.dirtyDeletions.size ||
      this.dirtyMoves.size;
    if (!anyDirty) this.deps.onState('idle');
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
    // After a failure, back off exponentially (5s, 10s, 20s… capped) rather than the
    // normal idle debounce — and edits made during an outage don't shorten the wait,
    // so a failing save stops hammering the server.
    const delay =
      this.failures > 0
        ? Math.min(this.retryMs * 2 ** (this.failures - 1), this.maxRetryMs)
        : this.idleMs;
    this.idleTimer = setTimeout(() => void this.flush(), delay);
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
    // These objects are in transit but not yet on the branch, so they stay "editing"
    // (not clean, not saved) until the commit lands — no mid-save badge flicker.
    this.flushingObjects = new Set(objects.map(([p]) => p));

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
      this.failures = 0; // success resets the backoff
      this.flushingObjects = new Set(); // landed → these become "saved", not "editing"
      this.notifyDirtyObjects();
      const stillDirty =
        this.dirtyObjects.size ||
        this.dirtyFiles.size ||
        this.dirtyAssets.size ||
        this.dirtyDeletions.size ||
        this.dirtyMoves.size;
      this.deps.onState(stillDirty ? 'dirty' : 'saved');
      if (stillDirty) this.schedule();
    } catch (err) {
      for (const [path, o] of objects) if (!this.dirtyObjects.has(path)) this.dirtyObjects.set(path, o);
      for (const [path, content] of rawFiles) if (!this.dirtyFiles.has(path)) this.dirtyFiles.set(path, content);
      for (const path of assets) this.dirtyAssets.add(path);
      for (const path of deletions) this.dirtyDeletions.add(path);
      for (const move of moves) if (!this.dirtyMoves.has(move.to)) this.dirtyMoves.set(move.to, move);
      for (const [newP, oldP] of renames) if (!this.dirtyRenames.has(newP)) this.dirtyRenames.set(newP, oldP);
      this.flushingObjects = new Set(); // back in dirtyObjects → still "editing"
      this.notifyDirtyObjects();
      this.failures += 1;
      this.deps.onError?.(err);
      this.deps.onState('error');
      this.schedule(); // exponential backoff (see schedule)
    } finally {
      this.flushing = false;
    }
  }
}

export interface Autosave {
  syncState: SyncState;
  /** Object paths with local-only (uncommitted) edits — drives the "Editing" badges. */
  editingPaths: ReadonlySet<string>;
  markObjectDirty: (path: string, data: FrontMatter, body: string) => void;
  markFileDirty: (path: string, content: string) => void;
  markAssetDirty: (path: string) => void;
  markPathsDeleted: (paths: string[]) => void;
  markObjectRenamed: (oldPath: string, newPath: string, data: FrontMatter, body: string, moves: MoveEntry[]) => void;
  markObjectRestored: (path: string, data: FrontMatter, body: string, moves: MoveEntry[]) => void;
  forgetBundle: (bundleDir: string) => void;
  forgetFile: (path: string) => void;
  getDirtyObject: (path: string) => DirtyObject | undefined;
  getDirtyFile: (path: string) => string | undefined;
  saveNow: () => void;
}

/** React binding for {@link Autosaver}: commits dirty edits to the session's WIP branch. */
export function useAutosave(session: RepoSession, assetStore: AssetStore): Autosave {
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [editingPaths, setEditingPaths] = useState<ReadonlySet<string>>(new Set());

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
        onError: (error) => {
          // Surface why a save failed so it's diagnosable from DevTools; the backoff
          // handles the retry cadence.
          console.warn('[timber] autosave failed; retrying with backoff:', error);
        },
        onState: setSyncState,
        onDirtyObjects: (paths) => setEditingPaths(new Set(paths)),
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
    editingPaths,
    markObjectDirty: (path, data, body) => saver.markObjectDirty(path, data, body),
    markFileDirty: (path, content) => saver.markFileDirty(path, content),
    markAssetDirty: (path) => saver.markAssetDirty(path),
    markPathsDeleted: (paths) => saver.markPathsDeleted(paths),
    markObjectRenamed: (oldPath, newPath, data, body, moves) =>
      saver.markObjectRenamed(oldPath, newPath, data, body, moves),
    markObjectRestored: (path, data, body, moves) => saver.markObjectRestored(path, data, body, moves),
    forgetBundle: (bundleDir) => saver.forgetBundle(bundleDir),
    forgetFile: (path) => saver.forgetFile(path),
    getDirtyObject: (path) => saver.getDirtyObject(path),
    getDirtyFile: (path) => saver.getDirtyFile(path),
    saveNow: () => void saver.saveNow(),
  };
}
