/**
 * The build progress bar (SPEC §12) — a hairline fill showing how far through a deploy
 * the site is, driven by **elapsed time against a typical run** rather than a count of
 * completed steps (see `deployProgressView` for why).
 *
 * Accessibility is the reason this is a component rather than three lines inline. The
 * banner it sits in is a `role="status"` live region, so anything that ticks inside it
 * gets *announced* — an ETA counting down would interrupt a screen-reader user every
 * time it changed. So the readout is `aria-hidden` and the progress is exposed as a
 * proper `progressbar` with `aria-live="off"`: available to anyone who navigates to it,
 * announced at nobody. Only the surrounding phase changes (started, deployed, failed)
 * are worth an interruption, and those stay in the live region's own text.
 */

import type { DeployProgressView } from '../state/deploy.js';
import { deployProgressText } from '../state/deploy.js';

interface DeployProgressBarProps {
  progress: DeployProgressView;
}

export function DeployProgressBar({
  progress,
}: DeployProgressBarProps): React.JSX.Element {
  const text = deployProgressText(progress);
  const pct =
    progress.fraction === undefined ? undefined : Math.round(progress.fraction * 100);
  return (
    <div
      className={`deploy-progress deploy-progress--${progress.phase}`}
      role="progressbar"
      aria-live="off"
      aria-label="Site build progress"
      {...(pct === undefined
        ? // No `aria-valuenow` at all is how ARIA spells "indeterminate" — queued, or
          // past the estimate, where any number would be made up.
          {}
        : { 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 })}
      {...(text ? { 'aria-valuetext': text } : {})}
    >
      <div
        className="deploy-progress__fill"
        style={pct === undefined ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * The matching text readout. `aria-hidden` for the reason given above — the bar it
 * accompanies carries the same information as `aria-valuetext`.
 */
export function DeployProgressText({
  progress,
}: DeployProgressBarProps): React.JSX.Element | null {
  const text = deployProgressText(progress);
  if (!text) return null;
  return (
    <span className="deploy-progress__text" aria-hidden="true">
      {text}
    </span>
  );
}
