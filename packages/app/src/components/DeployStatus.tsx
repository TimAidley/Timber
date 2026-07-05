import { useEffect, useState } from 'react';
import type { WorkflowRun } from '@timber/github';
import { deployState, type DeployState } from '../state/deploy.js';

/** Just the RepoClient method this needs — keeps the component mockable. */
export interface DeployStatusClient {
  getLatestWorkflowRun(workflowFile: string, branch?: string): Promise<WorkflowRun | undefined>;
}

interface DeployStatusProps {
  client: DeployStatusClient;
  /** The deploy workflow's file name (SPEC §12; the starter template is deploy.yml). */
  workflowFile: string;
  branch: string;
  /** Bumped after a publish to (re)start polling for the new run. */
  pollKey: number;
}

// Labels are about the SITE's last deploy to GitHub Pages — deliberately prefixed
// with "Site" so this isn't misread as the publish state of the page being edited
// (that's the draft/public flag + the Publish action, not this indicator).
const LABEL: Record<Exclude<DeployState, 'none'>, string> = {
  building: 'Site building…',
  published: 'Site deployed ✓',
  failed: 'Site deploy failed',
};

const TITLE =
  "The site's last deploy to GitHub Pages. This is not whether the page you're editing is published — use Publish to push your changes live.";

const POLL_MS = 5000;

/**
 * The in-editor deploy-status indicator (SPEC §12: "building… / published ✓ /
 * failed"). Polls the deploy workflow's latest run — after a publish it re-checks,
 * and keeps polling while a build is in progress, then stops.
 */
export function DeployStatus({ client, workflowFile, branch, pollKey }: DeployStatusProps): React.JSX.Element | null {
  const [run, setRun] = useState<WorkflowRun | undefined>(undefined);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      try {
        const latest = await client.getLatestWorkflowRun(workflowFile, branch);
        if (cancelled) return;
        setRun(latest);
        setChecked(true);
        if (deployState(latest) === 'building') timer = setTimeout(() => void poll(), POLL_MS);
      } catch {
        if (!cancelled) setChecked(true);
      }
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, workflowFile, branch, pollKey]);

  const state = deployState(run);
  if (!checked || state === 'none') return null;

  return (
    <div className={`deploy deploy--${state}`} title={TITLE}>
      <span className="deploy__dot" aria-hidden="true" />
      {run?.url ? (
        <a className="deploy__label" href={run.url} target="_blank" rel="noreferrer">
          {LABEL[state]}
        </a>
      ) : (
        <span className="deploy__label">{LABEL[state]}</span>
      )}
    </div>
  );
}
