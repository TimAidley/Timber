import type { DeployProgress, DeployRun } from '@timber/host';

/** The editor's deploy-status states (SPEC §12). */
export type DeployState = 'none' | 'building' | 'published' | 'failed';

/**
 * Interpret the latest deploy run for the status indicator. Pure, so it's unit-tested
 * without React or the network: no run → nothing to show; not yet completed → building;
 * completed → published (success) or failed.
 */
export function deployState(run: DeployRun | undefined): DeployState {
  if (!run) return 'none';
  if (run.status !== 'completed') return 'building';
  return run.conclusion === 'success' ? 'published' : 'failed';
}

/**
 * How far along the running build is, ready to render (SPEC §12). Where
 * {@link DeployProgress} is what the *host* knows, this is what the *editor* shows —
 * the split that keeps every presentation decision in one place instead of duplicated
 * across adapters.
 */
export interface DeployProgressView {
  /**
   * `queued`: waiting for a runner. `running`: building, with an estimate to measure
   * against. `overrun`: running, but past the time a build usually takes.
   */
  phase: 'queued' | 'running' | 'overrun';
  /** Bar fill 0..1, or `undefined` for an indeterminate bar (queued, overrun, no estimate). */
  fraction: number | undefined;
  /** Human ETA, e.g. "about 2 minutes left". Absent when there's no estimate to give. */
  remaining: string | undefined;
  /** What the build is doing right now, e.g. "Build the site". Absent when unknown. */
  label: string | undefined;
}

/**
 * The bar stops short of full while the build is still running. A bar that sits at 100%
 * for the last stretch reads as finished-but-stuck, which is worse than reading as
 * nearly-done — and since the estimate is a median, roughly half of all builds *will*
 * reach their estimate before they finish.
 */
const PROGRESS_CAP = 0.95;

/** Below this, "about 1 minute" overstates the wait; say something vaguer instead. */
const SUB_MINUTE_MS = 45_000;

/**
 * Build the view for a running deploy, or `undefined` when there is nothing to add to a
 * plain "Building…" — no host progress *and* no duration estimate.
 *
 * Progress is measured as **elapsed time against a typical run**, never as a count of
 * completed steps. Steps are the wrong unit: hosts count incomparable things, the total
 * isn't known until the run is nearly over, and a count that jumps mid-run beside a
 * smoothly advancing bar just invites the question of which one is lying (SPEC §12).
 */
export function deployProgressView(input: {
  /** What the host reports about the running deploy, if it reports anything. */
  progress: DeployProgress | undefined;
  /** How long a deploy usually takes, in ms — `undefined` if never measured. */
  typicalMs: number | undefined;
  /** How long this deploy has been going, in ms — `undefined` if the start is unknown. */
  elapsedMs: number | undefined;
}): DeployProgressView | undefined {
  const { progress, typicalMs, elapsedMs } = input;
  if (!progress && typicalMs === undefined) return undefined;
  const label = progress?.label;

  // Queued: no execution time has elapsed, so there is nothing to measure and a creeping
  // bar would be a lie. Indeterminate until a runner picks the build up.
  if (progress?.phase === 'queued') {
    return { phase: 'queued', fraction: undefined, remaining: undefined, label };
  }

  // Running, but with no basis for an estimate (first-ever deploy, or a host that can't
  // report timings): show the label and an indeterminate bar rather than inventing a
  // duration — the failure mode that made the old hard-coded "about a minute" wrong.
  if (typicalMs === undefined || elapsedMs === undefined || typicalMs <= 0) {
    return { phase: 'running', fraction: undefined, remaining: undefined, label };
  }

  // Past the estimate: stop pretending to know. Freezing the bar at its cap would read as
  // a hung build, so go indeterminate and let the copy say what's happening.
  if (elapsedMs >= typicalMs) {
    return { phase: 'overrun', fraction: undefined, remaining: undefined, label };
  }

  return {
    phase: 'running',
    fraction: Math.min(elapsedMs / typicalMs, PROGRESS_CAP),
    remaining: formatRemaining(typicalMs - elapsedMs),
    label,
  };
}

/**
 * Round an ETA to something a person would say. Deliberately coarse: the underlying
 * number is a median of a handful of past builds, so a to-the-second countdown would
 * project a precision the estimate doesn't have — and would tick visibly backwards
 * whenever a build ran slower than its median.
 */
function formatRemaining(ms: number): string {
  if (ms < SUB_MINUTE_MS) return 'less than a minute left';
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `about ${minutes} minute${minutes === 1 ? '' : 's'} left`;
}

/**
 * The one-line readout beside the progress bar, or `undefined` when there's nothing
 * worth saying. Kept here rather than in the component so the wording for each phase is
 * unit-tested and shared by every surface that shows build progress.
 */
export function deployProgressText(view: DeployProgressView): string | undefined {
  if (view.phase === 'queued') return 'Queued — waiting for a runner';
  const tail = view.phase === 'overrun' ? 'taking longer than usual' : view.remaining;
  if (view.label && tail) return `${view.label} — ${tail}`;
  return view.label ?? (tail ? capitalize(tail) : undefined);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
