import { useEffect, useState } from 'react';
import type { DeployBackend } from '@timber/host';
import { deployState, type DeployState } from './deploy.js';

const POLL_MS = 5000;

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
 */
export function useDeployPoll(
  deploy: DeployBackend | undefined,
  branch: string,
  active: boolean,
  since: string | undefined,
): DeployState {
  const [state, setState] = useState<DeployState>('none');

  useEffect(() => {
    if (!active || !deploy) {
      setState('none');
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      let next: DeployState = 'building';
      try {
        const run = await deploy.getLatestDeploy(branch);
        // Ignore a run that isn't newer than the pre-publish baseline — our deploy
        // hasn't started yet, so keep showing "building".
        const isOurs = run !== undefined && (since === undefined || run.createdAt > since);
        next = isOurs ? deployState(run) : 'building';
      } catch {
        next = 'building'; // transient error → keep waiting
      }
      if (cancelled) return;
      setState(next);
      if (next === 'building' || next === 'none') timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [deploy, branch, active, since]);

  return state;
}
