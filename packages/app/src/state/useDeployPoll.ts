import { useEffect, useState } from 'react';
import type { DeployBackend } from '@timber/host';
import {
  deployProgressView,
  deployState,
  type DeployProgressView,
  type DeployState,
} from './deploy.js';
import { diagnostics } from './diagnostics.js';

const POLL_MS = 5000;

/** The deploy indicator's state, plus how far along the build is when the host can say. */
export interface DeployStatus {
  state: DeployState;
  /** Present only while building, and only when there's progress or an ETA to show. */
  progress?: DeployProgressView;
}

/**
 * Poll the host's deploy capability after a publish and report its state for the Publish
 * button's morph (Building… → Published ✓ / failed). Only runs while `active` — and only
 * when the host HAS a {@link DeployBackend}: a host with no CI passes `undefined`, so the
 * hook stays at `none` and the deploy morph never appears (SPEC §12 degrades gracefully).
 *
 * `since` is the created-time of the latest run observed *before* this publish (or
 * undefined if there was none). A run at or before `since` is a **stale prior deploy**,
 * so it reads as `building` (our new run hasn't appeared yet) rather than flashing a
 * premature success — the race the old pollKey approach couldn't avoid.
 *
 * **Progress is a second, optional layer.** Where the backend implements
 * `getTypicalDeployDurationMs` / `getDeployProgress` the poll also reports an ETA and
 * what the build is doing; where it doesn't — or where either call fails — the hook
 * returns state alone and the UI falls back to a plain "Building…". Nothing about the
 * status leg depends on the progress leg working.
 */
export function useDeployPoll(
  deploy: DeployBackend | undefined,
  branch: string,
  active: boolean,
  since: string | undefined,
): DeployStatus {
  const [status, setStatus] = useState<DeployStatus>({ state: 'none' });

  useEffect(() => {
    if (!active || !deploy) {
      setStatus({ state: 'none' });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Fired once per activation, not per poll: how long a build takes is a property of
    // the site, not of this run. Kicked off here so it's in flight alongside the first
    // status request instead of adding a round trip before the first paint.
    const typicalPromise: Promise<number | undefined> = deploy.getTypicalDeployDurationMs
      ? deploy.getTypicalDeployDurationMs(branch).catch((err: unknown) => {
          diagnostics.record('warn', 'deploy', 'deploy duration estimate failed', err);
          return undefined;
        })
      : Promise.resolve(undefined);

    const poll = async (): Promise<void> => {
      let next: DeployState = 'building';
      let progress: DeployProgressView | undefined;
      try {
        const run = await deploy.getLatestDeploy(branch);
        // Ignore a run that isn't newer than the pre-publish baseline — our deploy
        // hasn't started yet, so keep showing "building".
        const isOurs = run !== undefined && (since === undefined || run.createdAt > since);
        next = isOurs ? deployState(run) : 'building';
        if (isOurs && next === 'building' && run) {
          progress = await pollProgress(deploy, run.id, run.startedAt ?? run.createdAt, {
            typicalMs: await typicalPromise,
          });
        }
      } catch (err) {
        // Treated as transient (keep showing "building"), but a poll that fails every
        // time looks identical to a build that never finishes — so record why.
        diagnostics.record('warn', 'deploy', 'deploy status poll failed', err);
        next = 'building';
      }
      if (cancelled) return;
      setStatus({ state: next, ...(progress ? { progress } : {}) });
      if (next === 'building' || next === 'none') timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [deploy, branch, active, since]);

  return status;
}

/**
 * One poll's worth of progress. Separated from the status leg because it is **decorative
 * and must never break the build indicator**: a host that doesn't implement it, a run
 * with no addressable id, or a call that simply fails all resolve to `undefined`, which
 * renders as today's plain "Building…".
 *
 * A failed progress call is swallowed rather than recorded. It repeats every 5s for the
 * length of a build, so logging it would bury the diagnostics panel — and unlike a failed
 * *status* poll it can't be mistaken for a stuck deploy, because the status leg is still
 * reporting normally right beside it.
 */
async function pollProgress(
  deploy: DeployBackend,
  runId: string | undefined,
  startedAt: string,
  timing: { typicalMs: number | undefined },
): Promise<DeployProgressView | undefined> {
  const progress =
    runId && deploy.getDeployProgress
      ? await deploy.getDeployProgress(runId).catch(() => undefined)
      : undefined;
  const started = Date.parse(startedAt);
  return deployProgressView({
    progress,
    typicalMs: timing.typicalMs,
    elapsedMs: Number.isFinite(started) ? Date.now() - started : undefined,
  });
}
