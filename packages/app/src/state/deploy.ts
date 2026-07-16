import type { DeployRun } from '@timber/host';

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
