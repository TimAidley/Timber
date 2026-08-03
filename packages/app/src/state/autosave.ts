import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileWrite, HostErrorInfo, MoveEntry } from '@timber/host';
import type { FrontMatter } from '@timber/generator';
import { reassembleDocument } from '../content/document.js';
import type { AssetStore } from './assets.js';
import type { RepoSession } from './repoSession.js';
import { diagnostics } from './diagnostics.js';

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
   * Notified whenever the set of paths with **local-only** (uncommitted) changes
   * changes — drives the per-item "Editing" badges + header count. Paths in flight
   * (being committed) stay included until the commit lands, so the badge doesn't
   * flicker to clean mid-save.
   *
   * Deliberately **total** over every dirty collection — objects, raw site files,
   * staged assets, deletions and moves alike. Each kind left out of this union has
   * produced the same bug in turn (first advanced-area files, then staged assets):
   * the header read "No unpublished changes" while a change sat queued for commit.
   * A new kind of pending change must be invisible-proof by construction, so
   * {@link Autosaver.notifyDirtyPaths} unions ALL of them, always.
   */
  onDirtyPaths?: (paths: string[]) => void;
  /** Notified on a failed flush (before the backoff retry) — surfaces the cause. */
  onError?: (error: unknown) => void;
  /**
   * Notified when a flush succeeds after one or more failures, with the number of
   * failed attempts. A log that only records failures can't tell "still broken" from
   * "blipped and recovered" — which is exactly the question a retry loop raises.
   */
  onRecovered?: (failedAttempts: number) => void;
  /**
   * Notified about a non-fatal oddity worth recording (currently: staged asset bytes
   * that vanished before the commit). These don't fail the save, which is precisely
   * why they need a log — otherwise the commit lands quietly missing a file.
   */
  onWarn?: (message: string, detail?: Record<string, unknown>) => void;
  /**
   * Notified once a flush lands with the asset paths it committed, so their locally
   * persisted byte copies (the crash-safety net in IndexedDB) can be dropped — the
   * branch is the durable copy from here on. Device-only assets never commit, so they
   * never appear here and their local copies live on.
   */
  onAssetsCommitted?: (paths: string[]) => void;
  /**
   * Whether an object path is parked **On this device** (SPEC §5/§8 storage axis).
   * Device-only objects are held out of the WIP commit entirely — their durable copy
   * is the IndexedDB draft, not the branch. Editing routes them around the autosaver,
   * so this is a defensive filter at the commit boundary (e.g. a demoted object that
   * was already queued). Defaults to "nothing is device-only".
   */
  isDeviceOnly?: (path: string) => boolean;
  idleMs?: number;
  retryMs?: number;
  /** Cap for the exponential retry backoff (default 60s). */
  maxRetryMs?: number;
  /**
   * Random spread (0–1) applied to every scheduled flush. Defaults to **0** so the
   * timing tests stay deterministic; the React binding turns it on, because two editor
   * tabs that collide on the same branch would otherwise back off by exactly the same
   * amount and collide again on the retry.
   */
  jitterRatio?: number;
  /** Injectable randomness (defaults to `Math.random`), so jitter is testable. */
  random?: () => number;
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
  /** Paths taken by an in-flight flush; kept in the "editing" set until it lands. */
  private flushingPaths = new Set<string>();
  private dirtyFiles = new Map<string, string>();
  private dirtyAssets = new Set<string>();
  private dirtyDeletions = new Set<string>();
  private dirtyMoves = new Map<string, MoveEntry>();
  /** New index.md path → old index.md path, for a clean "rename …" commit summary. */
  private dirtyRenames = new Map<string, string>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  /** The in-flight flush, so a concurrent {@link saveNow} can await it rather than no-op. */
  private inFlight: Promise<void> | null = null;
  /** Consecutive failed flushes; drives exponential retry backoff, reset on success. */
  private failures = 0;
  private readonly idleMs: number;
  private readonly retryMs: number;
  private readonly maxRetryMs: number;
  private readonly jitterRatio: number;
  private readonly random: () => number;

  constructor(private readonly deps: AutosaverDeps) {
    this.idleMs = deps.idleMs ?? 5000; // SPEC §11: ~5–15s idle, not per-keystroke
    this.retryMs = deps.retryMs ?? 5000;
    this.maxRetryMs = deps.maxRetryMs ?? 60000;
    this.jitterRatio = deps.jitterRatio ?? 0;
    this.random = deps.random ?? Math.random;
  }

  /** Spread a delay by ±`jitterRatio` so concurrent editors don't retry in lockstep. */
  private jittered(delay: number): number {
    if (this.jitterRatio <= 0) return delay;
    return Math.round(delay * (1 + (this.random() * 2 - 1) * this.jitterRatio));
  }

  /**
   * Emit the current "editing" path set (uncommitted changes + in-flight). The union
   * spans EVERY dirty collection (see {@link AutosaverDeps.onDirtyPaths}) — adding a
   * new collection to this class means adding it here, or its changes are invisible
   * until they reach the branch.
   */
  private notifyDirtyPaths(): void {
    this.deps.onDirtyPaths?.([
      ...new Set([
        ...this.dirtyObjects.keys(),
        ...this.dirtyFiles.keys(),
        ...this.dirtyAssets,
        ...this.dirtyDeletions,
        ...this.dirtyMoves.keys(),
        ...this.flushingPaths,
      ]),
    ]);
  }

  /** Whether anything at all is queued for the next commit. */
  private hasPending(): boolean {
    return (
      this.dirtyObjects.size > 0 ||
      this.dirtyFiles.size > 0 ||
      this.dirtyAssets.size > 0 ||
      this.dirtyDeletions.size > 0 ||
      this.dirtyMoves.size > 0
    );
  }

  markObjectDirty(path: string, data: FrontMatter, body: string): void {
    this.dirtyObjects.set(path, { data, body });
    this.notifyDirtyPaths();
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
    this.notifyDirtyPaths();
    this.deps.onState('dirty');
    this.schedule();
  }

  markAssetDirty(path: string): void {
    this.dirtyAssets.add(path);
    this.notifyDirtyPaths();
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
    this.notifyDirtyPaths();
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
    this.notifyDirtyPaths();
    this.deps.onState('dirty');
    this.schedule();
  }

  /**
   * Stage a newly-created object plus any colocated assets copied by **reusing existing
   * blob SHAs** (SPEC §5 → Multilingual "Add translation"). The moves are `from === to`
   * re-adds at the new bundle's paths, so the source bundle's assets are copied, not
   * moved — no deletion. The `index.md` write + the copies land in the next coalesced
   * WIP commit. (A create with no assets is just {@link markObjectDirty}.)
   */
  markObjectCreated(path: string, data: FrontMatter, body: string, moves: MoveEntry[]): void {
    this.dirtyObjects.set(path, { data, body });
    for (const move of moves) this.dirtyMoves.set(move.to, move);
    this.notifyDirtyPaths();
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
    this.notifyDirtyPaths();
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
    this.notifyDirtyPaths();
    if (!this.hasPending()) this.deps.onState('idle');
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
    this.notifyDirtyPaths();
    if (!this.hasPending()) this.deps.onState('idle');
  }

  getDirtyObject(path: string): DirtyObject | undefined {
    return this.dirtyObjects.get(path);
  }

  getDirtyFile(path: string): string | undefined {
    return this.dirtyFiles.get(path);
  }

  /**
   * Flush immediately (explicit save / tab hide / before publishing) and resolve once
   * everything queued at call time has actually landed on the branch — resolving to
   * `true` when nothing is left pending, `false` when the flush failed and the edits
   * are still local (the backoff retry will pick them up).
   *
   * Awaiting an *in-flight* flush is the point: a bare `if (flushing) return` resolved
   * instantly while the caller's own edits sat in the dirty map, so Publish could plan
   * against a WIP tip that predated them and ship the previous version. A flush already
   * running may also have been taken *before* those edits, so a second pass commits
   * whatever it left behind.
   */
  async saveNow(): Promise<boolean> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    await this.flush(); // joins an in-flight flush rather than skipping past it
    // Anything the joined flush had already taken its snapshot before goes in a second
    // pass — unless that flush failed, in which case the backoff owns the retry and
    // hammering it again here would only shorten the wait we deliberately lengthened.
    if (this.failures === 0 && this.hasPending()) await this.flush();
    return !this.hasPending();
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
    this.idleTimer = setTimeout(() => void this.flush(), this.jittered(delay));
  }

  /**
   * Run a flush, or — if one is already running — hand back *its* promise so callers
   * can await the commit in progress instead of racing past it.
   */
  private flush(): Promise<void> {
    if (this.flushing) return this.inFlight ?? Promise.resolve();
    const run = this.doFlush().finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async doFlush(): Promise<void> {
    if (!this.hasPending()) return;

    // Optimistically take the dirty set; restore it on failure. Device-only objects
    // (SPEC §5/§8) are dropped here — never committed, never re-queued; their durable
    // copy is the IndexedDB draft.
    const isDeviceOnly = this.deps.isDeviceOnly ?? (() => false);
    const objects = [...this.dirtyObjects.entries()].filter(([path]) => !isDeviceOnly(path));
    const rawFiles = [...this.dirtyFiles.entries()];
    // Colocated assets of a device-only bundle are dropped too — same rule as its index.md.
    const assets = [...this.dirtyAssets].filter((path) => !isDeviceOnly(path));
    const deletions = [...this.dirtyDeletions];
    const moves = [...this.dirtyMoves.values()];
    const renames = new Map(this.dirtyRenames);
    this.dirtyObjects = new Map();
    this.dirtyFiles = new Map();
    this.dirtyAssets = new Set();
    this.dirtyDeletions = new Set();
    this.dirtyMoves = new Map();
    this.dirtyRenames = new Map();

    // If only device-only objects were dirty there is nothing to commit — settle the
    // state without an empty commit (the drafts are already persisted locally).
    if (
      objects.length === 0 &&
      rawFiles.length === 0 &&
      assets.length === 0 &&
      deletions.length === 0 &&
      moves.length === 0
    ) {
      this.notifyDirtyPaths();
      this.deps.onState('idle');
      return;
    }
    // These paths are in transit but not yet on the branch, so they stay "editing"
    // (not clean, not saved) until the commit lands — no mid-save badge flicker.
    // Total over the whole snapshot (assets, deletions and moves included), like the
    // dirty union itself.
    this.flushingPaths = new Set([
      ...objects.map(([p]) => p),
      ...rawFiles.map(([p]) => p),
      ...assets,
      ...deletions,
      ...moves.map((m) => m.to),
    ]);
    this.notifyDirtyPaths();

    this.flushing = true;
    this.deps.onState('saving');
    try {
      const assetFiles = await Promise.all(
        assets.map(async (path): Promise<FileWrite | null> => {
          const bytes = await this.deps.assetBytes(path);
          if (!bytes) {
            // Dropping the file silently would land a commit whose page is simply
            // missing its image — a "successful" save that lost data. It can't fail the
            // commit (the rest of the edit is fine), so it must at least be diagnosable.
            this.deps.onWarn?.('staged asset bytes unavailable — not committed', { path });
            return null;
          }
          return { path, bytes };
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
      if (this.failures > 0) this.deps.onRecovered?.(this.failures);
      this.failures = 0; // success resets the backoff
      if (assets.length > 0) this.deps.onAssetsCommitted?.(assets);
      this.flushingPaths = new Set(); // landed → these become "saved", not "editing"
      this.notifyDirtyPaths();
      const stillDirty = this.hasPending();
      this.deps.onState(stillDirty ? 'dirty' : 'saved');
      if (stillDirty) this.schedule();
    } catch (err) {
      for (const [path, o] of objects) if (!this.dirtyObjects.has(path)) this.dirtyObjects.set(path, o);
      for (const [path, content] of rawFiles) if (!this.dirtyFiles.has(path)) this.dirtyFiles.set(path, content);
      for (const path of assets) this.dirtyAssets.add(path);
      for (const path of deletions) this.dirtyDeletions.add(path);
      for (const move of moves) if (!this.dirtyMoves.has(move.to)) this.dirtyMoves.set(move.to, move);
      for (const [newP, oldP] of renames) if (!this.dirtyRenames.has(newP)) this.dirtyRenames.set(newP, oldP);
      this.flushingPaths = new Set(); // back in the dirty maps → still "editing"
      this.notifyDirtyPaths();
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
  /**
   * Why the last flush failed, normalised through the host port — `null` once a save
   * succeeds. Drives the header's "Save failed — <reason>" and, for a non-retryable
   * cause like an expired session, the offer to sign in again instead of retrying.
   */
  lastError: HostErrorInfo | null;
  /**
   * Paths with local-only (uncommitted) changes — drives the "Editing" badges. Total
   * over every kind of pending change: content objects, raw site files, staged
   * assets, deletions and moves alike.
   */
  editingPaths: ReadonlySet<string>;
  markObjectDirty: (path: string, data: FrontMatter, body: string) => void;
  markFileDirty: (path: string, content: string) => void;
  markAssetDirty: (path: string) => void;
  markPathsDeleted: (paths: string[]) => void;
  markObjectCreated: (path: string, data: FrontMatter, body: string, moves: MoveEntry[]) => void;
  markObjectRenamed: (oldPath: string, newPath: string, data: FrontMatter, body: string, moves: MoveEntry[]) => void;
  markObjectRestored: (path: string, data: FrontMatter, body: string, moves: MoveEntry[]) => void;
  forgetBundle: (bundleDir: string) => void;
  forgetFile: (path: string) => void;
  getDirtyObject: (path: string) => DirtyObject | undefined;
  getDirtyFile: (path: string) => string | undefined;
  /**
   * Flush pending edits now, resolving `true` once they're on the branch (or `false` if
   * the commit failed and they're still local). Publish **awaits** this — see
   * {@link Autosaver.saveNow}.
   */
  saveNow: () => Promise<boolean>;
}

/**
 * React binding for {@link Autosaver}: commits dirty edits to the session's WIP branch.
 * `isDeviceOnly` (SPEC §5/§8) is read through a ref so the predicate can change with the
 * editor's storage-level state without rebuilding — and blurring — the autosaver.
 */
export function useAutosave(
  session: RepoSession,
  assetStore: AssetStore,
  isDeviceOnly?: (path: string) => boolean,
  onAssetsCommitted?: (paths: string[]) => void,
): Autosave {
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [editingPaths, setEditingPaths] = useState<ReadonlySet<string>>(new Set());
  const [lastError, setLastError] = useState<HostErrorInfo | null>(null);

  const isDeviceOnlyRef = useRef(isDeviceOnly);
  isDeviceOnlyRef.current = isDeviceOnly;
  const onAssetsCommittedRef = useRef(onAssetsCommitted);
  onAssetsCommittedRef.current = onAssetsCommitted;

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
        isDeviceOnly: (path) => isDeviceOnlyRef.current?.(path) ?? false,
        onAssetsCommitted: (paths) => onAssetsCommittedRef.current?.(paths),
        onError: (error) => {
          // Normalise + record the cause, and keep the verdict for the UI: a 401 means
          // the retry loop can never succeed, and the header should say so rather than
          // showing "retrying" forever.
          setLastError(diagnostics.error('autosave', 'save to your branch failed', error));
        },
        onRecovered: (failedAttempts) => {
          diagnostics.info('autosave', `save succeeded after ${failedAttempts} failed attempt(s)`);
        },
        onWarn: (message, detail) => {
          diagnostics.warn('autosave', message, detail);
        },
        // Spread both the idle debounce and the failure backoff, so two tabs editing the
        // same branch stop colliding on the same schedule.
        jitterRatio: 0.25,
        onState: (state) => {
          // A landed commit clears the failure; 'saving' deliberately doesn't, so the
          // reason stays readable while the retry is in flight.
          if (state === 'saved' || state === 'idle') setLastError(null);
          setSyncState(state);
        },
        onDirtyPaths: (paths) => setEditingPaths(new Set(paths)),
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
    lastError,
    editingPaths,
    markObjectDirty: (path, data, body) => saver.markObjectDirty(path, data, body),
    markFileDirty: (path, content) => saver.markFileDirty(path, content),
    markAssetDirty: (path) => saver.markAssetDirty(path),
    markPathsDeleted: (paths) => saver.markPathsDeleted(paths),
    markObjectCreated: (path, data, body, moves) => saver.markObjectCreated(path, data, body, moves),
    markObjectRenamed: (oldPath, newPath, data, body, moves) =>
      saver.markObjectRenamed(oldPath, newPath, data, body, moves),
    markObjectRestored: (path, data, body, moves) => saver.markObjectRestored(path, data, body, moves),
    forgetBundle: (bundleDir) => saver.forgetBundle(bundleDir),
    forgetFile: (path) => saver.forgetFile(path),
    getDirtyObject: (path) => saver.getDirtyObject(path),
    getDirtyFile: (path) => saver.getDirtyFile(path),
    saveNow: () => saver.saveNow(),
  };
}
