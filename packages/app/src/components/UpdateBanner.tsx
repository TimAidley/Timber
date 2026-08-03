/**
 * The out-of-date banner (SPEC §12). Shown when the editor bundle was built from a
 * Timber commit that the branch it follows has since moved past — offering a one-click
 * redeploy that rebuilds the site + editor from the latest Timber. Purely presentational:
 * the Editor owns the drift check, the deploy dispatch, and the poll; this renders the
 * current phase and wires the button.
 */

import { Spinner } from './Spinner.js';
import { DeployProgressBar, DeployProgressText } from './DeployProgressBar.js';
import type { DeployProgressView } from '../state/deploy.js';

/** Where a triggered update is in its lifecycle. */
export type UpdatePhase = 'idle' | 'updating' | 'done' | 'failed';

interface UpdateBannerProps {
  /** How many commits behind the followed ref the build is (for the message). */
  behindBy: number | undefined;
  phase: UpdatePhase;
  /**
   * How far along the rebuild is, when the host can say (SPEC §12). Absent for a host
   * with no progress support and for a site with no previous deploy to estimate from —
   * in which case the banner promises no duration at all, rather than the fixed "about a
   * minute" it used to assert to everyone regardless of what their build actually took.
   */
  progress?: DeployProgressView;
  /** Trigger a redeploy (idle) or retry a failed one. */
  onUpdate: () => void;
  /** Reload the page to pick up the freshly deployed bundle (after `done`). */
  onReload: () => void;
}

function commitsBehind(n: number | undefined): string {
  if (!n || n <= 0) return 'A newer version is available';
  return `A newer version is available (${n} commit${n === 1 ? '' : 's'} behind)`;
}

export function UpdateBanner({
  behindBy,
  phase,
  progress,
  onUpdate,
  onReload,
}: UpdateBannerProps): React.JSX.Element {
  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="update-banner__icon" aria-hidden="true">
        ⟳
      </span>
      {phase === 'updating' ? (
        <>
          {/* This sentence is what the live region announces, so it stays fixed for the
              whole phase — the ticking detail lives in the aria-hidden readout beside
              it, and in the bar's own aria-valuetext. */}
          <span className="update-banner__text">
            Rebuilding with the latest Timber. You can keep editing; we’ll offer a reload
            when it’s ready.
          </span>
          {progress ? <DeployProgressText progress={progress} /> : null}
          <button type="button" className="update-banner__action" disabled aria-busy="true">
            <Spinner />
            Building…
          </button>
          {progress ? <DeployProgressBar progress={progress} /> : null}
        </>
      ) : phase === 'done' ? (
        <>
          <span className="update-banner__text">
            Update deployed. Reload to use the new version.
          </span>
          <button type="button" className="update-banner__action" onClick={onReload}>
            Reload
          </button>
        </>
      ) : phase === 'failed' ? (
        <>
          <span className="update-banner__text">
            The update couldn’t be started. Check the deploy workflow, then try again.
          </span>
          <button type="button" className="update-banner__action" onClick={onUpdate}>
            Retry
          </button>
        </>
      ) : (
        <>
          <span className="update-banner__text">
            {commitsBehind(behindBy)} for this editor.
          </span>
          <button type="button" className="update-banner__action" onClick={onUpdate}>
            Update now
          </button>
        </>
      )}
    </div>
  );
}
