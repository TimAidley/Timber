import { useEffect, useRef, useState } from 'react';
import type { ChangedPath } from '@timber/host';
import { diagnostics } from './diagnostics.js';
import type { OwnWrites } from './ownWrites.js';

/**
 * Notice when **someone else** commits to the WIP branch (SPEC §11).
 *
 * The branch is shared — a second editor tab, another device, the same person on their
 * laptop — and every tab holds its own in-memory copy of the content taken at load time.
 * Two tabs editing *different* files is harmless (commits overlay, nothing is lost, and
 * the client now absorbs the ref race silently). Two tabs editing the *same* file is
 * not: the second save overwrites the first with no error at all, because it's a
 * perfectly clean fast-forward. That silent case is what this watches for.
 *
 * v1 is deliberately a **warning**, not a merge: detect it, name the files, show what
 * they changed, and let the author decide — the same detect-don't-resolve posture the
 * spec takes for publish conflicts.
 */

export interface ForeignPath {
  path: string;
  status: ChangedPath['status'];
  /**
   * True when we're holding local edits to the same file — i.e. our next save will
   * overwrite what they just committed. This is the row that actually needs a human.
   */
  overlapping: boolean;
}

export interface ForeignChange {
  /** The tip the other writer created — the "theirs" side of each diff. */
  sha: string;
  /** The last tip we agreed on — the "before" side of each diff. */
  baseSha: string;
  paths: ForeignPath[];
}

/** Split what they changed into "also being edited here" and the rest. */
export function classifyForeignPaths(
  changed: readonly ChangedPath[],
  editingPaths: ReadonlySet<string>,
): ForeignPath[] {
  return changed
    .map((c) => ({ path: c.path, status: c.status, overlapping: editingPaths.has(c.path) }))
    // Overlapping files first — they're the ones with a decision attached.
    .sort((a, b) => Number(b.overlapping) - Number(a.overlapping) || a.path.localeCompare(b.path));
}

/** The slice of the host port this watcher needs (fakeable in tests). */
export interface ForeignWatchClient {
  getBranchSha(branch: string): Promise<string | undefined>;
  compareChangedPaths(base: string, head: string): Promise<ChangedPath[]>;
}

export interface ForeignWatchOptions {
  client: ForeignWatchClient;
  branch: string;
  own: OwnWrites;
  /** The WIP tip this session loaded — the baseline. Undefined if the branch didn't exist. */
  initialSha: string | undefined;
  /** Paths with local edits, for the overlap flag. Read live; doesn't restart the poll. */
  editingPaths: ReadonlySet<string>;
  /** Suspend while one of our own commits is in flight — its tip would read as foreign. */
  paused: boolean;
  pollMs?: number;
  /** Grace period before believing a tip is foreign (see below). */
  settleMs?: number;
}

const DEFAULT_POLL_MS = 20_000;
/**
 * A commit of ours can land on the host a beat before it's recorded locally, so a poll
 * that lands in that gap would read our own work as a stranger's. Re-checking after a
 * short pause costs one timer and removes the whole class of false alarm.
 */
const DEFAULT_SETTLE_MS = 1500;

export interface DetectOptions {
  branch: string;
  own: OwnWrites;
  /** The newest tip we've already accounted for. */
  knownTip: string | undefined;
  /** Base of an outstanding, undismissed warning, so a second commit re-diffs from it. */
  pendingBase: string | undefined;
  editingPaths: ReadonlySet<string>;
  settleMs: number;
  /** Injectable wait, so tests don't sleep. */
  settle: (ms: number) => Promise<void>;
}

export interface DetectResult {
  /** The tip now accounted for — adopt as `knownTip` (undefined ⇒ leave it alone). */
  tip: string | undefined;
  change: ForeignChange | null;
}

/**
 * One check of the branch tip, as a pure-ish async function so the decision logic is
 * unit-testable without React: is the tip new, is it ours, and if it's someone else's,
 * what did they change?
 */
export async function detectForeignChange(
  client: ForeignWatchClient,
  o: DetectOptions,
): Promise<DetectResult> {
  const tip = await client.getBranchSha(o.branch);
  if (!tip || tip === o.knownTip) return { tip: undefined, change: null };
  if (o.own.has(tip)) return { tip, change: null };

  // It may still be ours — a commit that reached the host just before we recorded it.
  await o.settle(o.settleMs);
  if (o.own.has(tip)) return { tip, change: null };

  const base = o.pendingBase ?? o.knownTip;
  // No baseline (we loaded before the branch existed) — adopt it; nothing to diff against.
  if (!base) return { tip, change: null };

  const changed = await client.compareChangedPaths(base, tip);
  if (changed.length === 0) return { tip, change: null };
  return { tip, change: { sha: tip, baseSha: base, paths: classifyForeignPaths(changed, o.editingPaths) } };
}

export interface ForeignChangeState {
  change: ForeignChange | null;
  dismiss: () => void;
}

export function useForeignChanges(options: ForeignWatchOptions): ForeignChangeState {
  const { client, branch, own, initialSha, pollMs = DEFAULT_POLL_MS, settleMs = DEFAULT_SETTLE_MS } = options;
  const [change, setChange] = useState<ForeignChange | null>(null);

  // Live values the poll reads without being restarted by them.
  const editingRef = useRef(options.editingPaths);
  editingRef.current = options.editingPaths;
  const pausedRef = useRef(options.paused);
  pausedRef.current = options.paused;

  /** The newest tip we've accounted for (ours or already-reported). */
  const knownTip = useRef<string | undefined>(initialSha);
  /**
   * The base of an outstanding, undismissed warning. A second foreign commit re-diffs
   * from here, so the panel keeps showing everything since we last agreed rather than
   * just the latest slice.
   */
  const pendingBase = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    async function check(): Promise<void> {
      if (cancelled || pausedRef.current) return;
      const { tip, change: found } = await detectForeignChange(client, {
        branch,
        own,
        knownTip: knownTip.current,
        pendingBase: pendingBase.current,
        editingPaths: editingRef.current,
        settleMs,
        settle: wait,
      });
      if (cancelled) return;
      if (tip) knownTip.current = tip;
      if (!found) return;

      pendingBase.current = found.baseSha;
      diagnostics.warn('branch', 'another writer committed to this branch', {
        sha: found.sha,
        base: found.baseSha,
        paths: found.paths.map((p) => p.path),
        overlapping: found.paths.filter((p) => p.overlapping).map((p) => p.path),
      });
      setChange(found);
    }

    async function loop(): Promise<void> {
      try {
        await check();
      } catch (err) {
        // A failing poll must not become a nag; record it and keep the cadence.
        diagnostics.record('warn', 'branch', 'could not check the branch for other writers', err);
      }
      if (!cancelled) timer = setTimeout(() => void loop(), pollMs);
    }

    // Returning to a tab is exactly when the other one has had time to work.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void check().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    timer = setTimeout(() => void loop(), pollMs);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [client, branch, own, pollMs, settleMs]);

  return {
    change,
    dismiss: () => {
      pendingBase.current = undefined;
      setChange(null);
    },
  };
}
