import { describe, expect, it } from 'vitest';
import { RepoClient, summarizeRunProgress } from '../src/index.js';

const OWNER = 'TimAidley';
const REPO = 'Timber-test-sandbox';

interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
}

/**
 * A fake `fetch` over the Actions endpoints this feature reads. Hand-written rather than
 * a recorded cassette because the interesting cases (a first-ever deploy with no prior
 * runs, a run whose second job hasn't been scheduled yet) are states a real sandbox repo
 * can't be posed in on demand.
 */
function fakeFetch(routes: Record<string, unknown>): {
  fetchImpl: typeof fetch;
  log: Recorded[];
} {
  const log: Recorded[] = [];
  const fetchImpl = (async (url: string | URL | Request, _init?: RequestInit) => {
    const parsed = new URL(String(url));
    log.push({ method: 'GET', path: parsed.pathname, query: parsed.searchParams });
    const body = routes[parsed.pathname];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, log };
}

function makeClient(routes: Record<string, unknown>) {
  const { fetchImpl, log } = fakeFetch(routes);
  const client = new RepoClient({
    owner: OWNER,
    repo: REPO,
    getToken: async () => 'fake-token',
    fetchImpl,
  });
  return { client, log };
}

const RUNS_PATH = `/repos/${OWNER}/${REPO}/actions/workflows/deploy.yml/runs`;
const JOBS_PATH = `/repos/${OWNER}/${REPO}/actions/runs/42/jobs`;

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    status: 'in_progress',
    conclusion: null,
    html_url: 'https://github.com/x/y/actions/runs/42',
    head_branch: 'main',
    created_at: '2026-08-03T10:00:00Z',
    run_started_at: '2026-08-03T10:00:30Z',
    updated_at: '2026-08-03T10:02:30Z',
    ...overrides,
  };
}

describe('summarizeRunProgress', () => {
  it('reads a run with no scheduled jobs as queued', () => {
    expect(summarizeRunProgress([])).toEqual({ phase: 'queued' });
  });

  it('reads jobs that have all yet to start as queued', () => {
    expect(summarizeRunProgress([{ status: 'queued' }, { status: 'waiting' }])).toEqual({
      phase: 'queued',
    });
  });

  it('names the step currently executing', () => {
    const jobs = [
      {
        status: 'in_progress',
        steps: [
          { name: 'Set up job', status: 'completed' },
          { name: 'Build the site', status: 'in_progress' },
          { name: 'Upload Pages artifact', status: 'queued' },
        ],
      },
    ];
    expect(summarizeRunProgress(jobs)).toEqual({
      phase: 'running',
      label: 'Build the site',
    });
  });

  it('is running-but-unlabelled while a job is starting up', () => {
    expect(summarizeRunProgress([{ status: 'in_progress' }])).toEqual({
      phase: 'running',
    });
    expect(summarizeRunProgress([{ status: 'in_progress', steps: [] }])).toEqual({
      phase: 'running',
    });
  });

  it('stays running in the gap between one job finishing and the next appearing', () => {
    // `deploy.yml`'s Pages job doesn't exist in the jobs API until `build` completes —
    // the exact moment a step *count* would have to revise its own denominator, and the
    // reason progress is measured in time instead.
    expect(summarizeRunProgress([{ status: 'completed', steps: [] }])).toEqual({
      phase: 'running',
    });
  });

  it('ignores a queued later job when an earlier one is executing', () => {
    const jobs = [
      {
        status: 'in_progress',
        steps: [{ name: 'Build the site', status: 'in_progress' }],
      },
      { status: 'queued', steps: [] },
    ];
    expect(summarizeRunProgress(jobs)).toEqual({
      phase: 'running',
      label: 'Build the site',
    });
  });
});

describe('RepoClient deploy progress (SPEC §12)', () => {
  it('carries the run id and its execution start on the DeployRun', async () => {
    const { client } = makeClient({ [RUNS_PATH]: { workflow_runs: [run()] } });
    expect(await client.deploy.getLatestDeploy('main')).toMatchObject({
      id: '42',
      startedAt: '2026-08-03T10:00:30Z',
      createdAt: '2026-08-03T10:00:00Z',
    });
  });

  it('omits startedAt when GitHub reports no execution start', async () => {
    const { client } = makeClient({
      [RUNS_PATH]: { workflow_runs: [run({ run_started_at: null })] },
    });
    const latest = await client.deploy.getLatestDeploy('main');
    expect(latest?.startedAt).toBeUndefined();
    expect(latest?.createdAt).toBe('2026-08-03T10:00:00Z');
  });

  it('estimates a typical duration from recent successful runs only', async () => {
    const { client, log } = makeClient({
      [RUNS_PATH]: {
        workflow_runs: [
          run({
            run_started_at: '2026-08-03T10:00:00Z',
            updated_at: '2026-08-03T10:02:00Z',
          }),
          run({
            run_started_at: '2026-08-03T09:00:00Z',
            updated_at: '2026-08-03T09:03:00Z',
          }),
          run({
            run_started_at: '2026-08-03T08:00:00Z',
            updated_at: '2026-08-03T08:04:00Z',
          }),
        ],
      },
    });
    expect(await client.deploy.getTypicalDeployDurationMs!('main')).toBe(180_000);
    const query = log.find((r) => r.path === RUNS_PATH)!.query;
    // Failures would drag the median down — a build that died in its first minute says
    // nothing about how long a working one takes.
    expect(query.get('status')).toBe('success');
    expect(query.get('branch')).toBe('main');
  });

  it('has no estimate for a site that has never deployed successfully', async () => {
    const { client } = makeClient({ [RUNS_PATH]: { workflow_runs: [] } });
    expect(await client.deploy.getTypicalDeployDurationMs!('main')).toBeUndefined();
  });

  it('measures execution rather than queue time', async () => {
    // created 10:00, picked up 10:02, finished 10:04 — a two-minute build that waited two
    // minutes for a runner. Quoting four would make every ETA wrong by the queue.
    const { client } = makeClient({
      [RUNS_PATH]: {
        workflow_runs: [
          run({
            created_at: '2026-08-03T10:00:00Z',
            run_started_at: '2026-08-03T10:02:00Z',
            updated_at: '2026-08-03T10:04:00Z',
          }),
        ],
      },
    });
    expect(await client.deploy.getTypicalDeployDurationMs!('main')).toBe(120_000);
  });

  it('reports what the run is doing right now', async () => {
    const { client, log } = makeClient({
      [JOBS_PATH]: {
        jobs: [
          {
            status: 'in_progress',
            steps: [{ name: 'Build the editor', status: 'in_progress' }],
          },
        ],
      },
    });
    expect(await client.deploy.getDeployProgress!('42')).toEqual({
      phase: 'running',
      label: 'Build the editor',
    });
    // `filter=latest` keeps a re-run's superseded attempt from naming a stale step.
    expect(log.find((r) => r.path === JOBS_PATH)!.query.get('filter')).toBe('latest');
  });
});
