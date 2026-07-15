/**
 * The out-of-date banner (SPEC §12). Shown when the editor bundle was built from a
 * Timber commit that the branch it follows has since moved past — offering a one-click
 * redeploy that rebuilds the site + editor from the latest Timber. Purely presentational:
 * the Editor owns the drift check, the deploy dispatch, and the poll; this renders the
 * current phase and wires the button.
 */

import { Spinner } from './Spinner.js';

/** Where a triggered update is in its lifecycle. */
export type UpdatePhase = 'idle' | 'updating' | 'done' | 'failed';

interface UpdateBannerProps {
  /** How many commits behind the followed ref the build is (for the message). */
  behindBy: number | undefined;
  phase: UpdatePhase;
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
          <span className="update-banner__text">
            Rebuilding with the latest Timber — this takes about a minute. You can keep
            editing; we’ll offer a reload when it’s ready.
          </span>
          <button type="button" className="update-banner__action" disabled aria-busy="true">
            <Spinner />
            Building…
          </button>
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
