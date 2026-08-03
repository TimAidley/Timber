import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '@timber/github';
import {
  deployProgressText,
  deployProgressView,
  deployState,
  type DeployProgressView,
} from '../src/state/deploy.js';

function run(status: string, conclusion: string | null): WorkflowRun {
  return { status, conclusion, url: 'https://x/runs/1', headBranch: 'main', createdAt: '' };
}

describe('deployState', () => {
  it('shows nothing when there is no run', () => {
    expect(deployState(undefined)).toBe('none');
  });

  it('shows building while queued or in progress', () => {
    expect(deployState(run('queued', null))).toBe('building');
    expect(deployState(run('in_progress', null))).toBe('building');
  });

  it('shows published on a successful completed run', () => {
    expect(deployState(run('completed', 'success'))).toBe('published');
  });

  it('shows failed on a non-success completed run', () => {
    expect(deployState(run('completed', 'failure'))).toBe('failed');
    expect(deployState(run('completed', 'cancelled'))).toBe('failed');
  });
});

describe('deployProgressView', () => {
  const MIN = 60_000;

  it('has nothing to show without host progress or an estimate', () => {
    // The degraded path every host starts on: a plain "Building…", no invented duration.
    expect(
      deployProgressView({ progress: undefined, typicalMs: undefined, elapsedMs: 30_000 }),
    ).toBeUndefined();
  });

  it('fills the bar by elapsed time against a typical run', () => {
    const view = deployProgressView({
      progress: { phase: 'running', label: 'Build the site' },
      typicalMs: 4 * MIN,
      elapsedMs: 1 * MIN,
    });
    expect(view).toEqual({
      phase: 'running',
      fraction: 0.25,
      remaining: 'about 3 minutes left',
      label: 'Build the site',
    });
  });

  it('stops short of full while the build is still running', () => {
    // Half of all builds overshoot a median estimate, so the bar must never claim done.
    const view = deployProgressView({
      progress: { phase: 'running' },
      typicalMs: 100_000,
      elapsedMs: 99_000,
    });
    expect(view?.fraction).toBeLessThan(1);
    expect(view?.fraction).toBe(0.95);
  });

  it('goes indeterminate once the estimate is overrun', () => {
    // Freezing a determinate bar at its cap is what reads as a hung build.
    const view = deployProgressView({
      progress: { phase: 'running', label: 'Deploy to GitHub Pages' },
      typicalMs: 2 * MIN,
      elapsedMs: 3 * MIN,
    });
    expect(view).toEqual({
      phase: 'overrun',
      fraction: undefined,
      remaining: undefined,
      label: 'Deploy to GitHub Pages',
    });
  });

  it('shows a queued run as waiting, not as 0% of a build', () => {
    const view = deployProgressView({
      progress: { phase: 'queued' },
      typicalMs: 2 * MIN,
      elapsedMs: 30_000,
    });
    expect(view).toMatchObject({ phase: 'queued', fraction: undefined, remaining: undefined });
  });

  it('labels the build without a bar when there is no estimate yet', () => {
    // A site's first deploy: the host can say what it's doing, just not for how long.
    expect(
      deployProgressView({
        progress: { phase: 'running', label: 'Install Timber deps' },
        typicalMs: undefined,
        elapsedMs: 10_000,
      }),
    ).toEqual({
      phase: 'running',
      fraction: undefined,
      remaining: undefined,
      label: 'Install Timber deps',
    });
  });

  it('needs a start time to measure against', () => {
    expect(
      deployProgressView({
        progress: { phase: 'running' },
        typicalMs: 2 * MIN,
        elapsedMs: undefined,
      }),
    ).toMatchObject({ phase: 'running', fraction: undefined });
  });

  it('rounds the ETA to something a person would say', () => {
    const remaining = (elapsedMs: number) =>
      deployProgressView({ progress: { phase: 'running' }, typicalMs: 10 * MIN, elapsedMs })
        ?.remaining;
    expect(remaining(0)).toBe('about 10 minutes left');
    expect(remaining(9 * MIN)).toBe('about 1 minute left');
    expect(remaining(9 * MIN + 30_000)).toBe('less than a minute left');
  });
});

describe('deployProgressText', () => {
  const view = (over: Partial<DeployProgressView>): DeployProgressView => ({
    phase: 'running',
    fraction: 0.5,
    remaining: 'about 2 minutes left',
    label: 'Build the site',
    ...over,
  });

  it('pairs what it is doing with how long is left', () => {
    expect(deployProgressText(view({}))).toBe('Build the site — about 2 minutes left');
  });

  it('says so plainly when a build outlasts its estimate', () => {
    expect(deployProgressText(view({ phase: 'overrun', remaining: undefined }))).toBe(
      'Build the site — taking longer than usual',
    );
  });

  it('explains a queued run rather than showing a stalled build', () => {
    expect(deployProgressText(view({ phase: 'queued' }))).toBe('Queued — waiting for a runner');
  });

  it('stands on its own with only one half available', () => {
    expect(deployProgressText(view({ label: undefined }))).toBe('About 2 minutes left');
    expect(deployProgressText(view({ remaining: undefined }))).toBe('Build the site');
    expect(deployProgressText(view({ label: undefined, remaining: undefined }))).toBeUndefined();
  });
});
