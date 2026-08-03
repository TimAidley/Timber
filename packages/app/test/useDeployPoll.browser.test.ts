import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DeployBackend, DeployProgress, DeployRun } from '@timber/host';
import { useDeployPoll, type DeployStatus } from '../src/state/useDeployPoll.js';

/**
 * The contract that matters for the progress feature: it is a **decorative second leg**
 * bolted onto the deploy poll, and the build indicator must survive it failing entirely.
 * A host with no progress support, one whose progress call throws, and one that can't
 * estimate a duration must all still drive Building… → Published ✓ exactly as before.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;
let seen: DeployStatus[] = [];

function Probe({ deploy }: { deploy: DeployBackend }): null {
  const status = useDeployPoll(deploy, 'main', true, undefined);
  seen.push(status);
  return null;
}

function mount(deploy: DeployBackend): void {
  seen = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(React.createElement(Probe, { deploy }));
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

/** Let the poll's async chain (status → typical → progress → setState) settle. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

const RUNNING: DeployRun = {
  status: 'in_progress',
  conclusion: null,
  url: 'https://github.com/x/y/actions/runs/42',
  headBranch: 'main',
  createdAt: '2026-08-03T10:00:00Z',
  id: '42',
  // Anchored to the mount so "elapsed" is a real, small number whatever the wall clock.
  startedAt: new Date(Date.now() - 60_000).toISOString(),
};

const DONE: DeployRun = { ...RUNNING, status: 'completed', conclusion: 'success' };

function backend(over: Partial<DeployBackend> & { run?: DeployRun }): DeployBackend {
  const { run = RUNNING, ...rest } = over;
  return {
    getLatestDeploy: async () => run,
    triggerDeploy: async () => undefined,
    ...rest,
  };
}

const latest = (): DeployStatus => seen[seen.length - 1]!;

describe('useDeployPoll progress leg', () => {
  it('reports state alone on a host with no progress support', async () => {
    mount(backend({ run: DONE }));
    await settle();
    expect(latest().state).toBe('published');
    expect(latest().progress).toBeUndefined();
  });

  it('still reaches published when the progress call throws', async () => {
    mount(
      backend({
        run: DONE,
        getTypicalDeployDurationMs: async () => {
          throw new Error('rate limited');
        },
        getDeployProgress: async () => {
          throw new Error('boom');
        },
      }),
    );
    await settle();
    expect(latest().state).toBe('published');
  });

  it('keeps showing the build when only the progress call fails', async () => {
    mount(
      backend({
        getTypicalDeployDurationMs: async () => 4 * 60_000,
        getDeployProgress: async () => {
          throw new Error('boom');
        },
      }),
    );
    await settle();
    expect(latest().state).toBe('building');
    // The ETA half still works — a failed label lookup costs the label, not the bar.
    expect(latest().progress?.fraction).toBeGreaterThan(0);
    expect(latest().progress?.label).toBeUndefined();
  });

  it('combines the host label with the measured estimate', async () => {
    const progress: DeployProgress = { phase: 'running', label: 'Build the site' };
    mount(
      backend({
        getTypicalDeployDurationMs: async () => 4 * 60_000,
        getDeployProgress: async () => progress,
      }),
    );
    await settle();
    expect(latest().progress).toMatchObject({
      phase: 'running',
      label: 'Build the site',
      remaining: 'about 3 minutes left',
    });
  });

  it('asks the host how long a build takes once, not once per poll', async () => {
    let calls = 0;
    mount(
      backend({
        getTypicalDeployDurationMs: async () => {
          calls += 1;
          return 60_000;
        },
        getDeployProgress: async () => ({ phase: 'running' }),
      }),
    );
    await settle();
    expect(calls).toBe(1);
  });

  it('carries no progress once the build is over', async () => {
    mount(
      backend({
        run: DONE,
        getTypicalDeployDurationMs: async () => 60_000,
        getDeployProgress: async () => ({ phase: 'running', label: 'Build the site' }),
      }),
    );
    await settle();
    expect(latest().state).toBe('published');
    expect(latest().progress).toBeUndefined();
  });
});
