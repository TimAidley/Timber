/**
 * A simulated GitHub Actions backend — just enough for the editor's deploy status
 * (SPEC §12): a push to the default branch (or a `workflow_dispatch`) creates a run of
 * the deploy workflow, and that run moves queued → in_progress → completed as time
 * passes.
 *
 * Progress is a pure function of the clock, not of timers: a run's status is derived
 * on every read from `now() - created_at` against the configured `queuedMs`/`runMs`.
 * That keeps the fake deterministic under test (inject `now`) while letting a virtual
 * user see a real "Building… ✓ Published" arc against the wall clock (default `now`).
 */

export type RunConclusion = 'success' | 'failure';

export interface ActionsOptions {
  /** How long a run waits for a runner before it starts. Default 0. */
  queuedMs?: number;
  /** How long a run executes before it completes. Default 0 (completes on the next read). */
  runMs?: number;
  /** Clock source; injected by tests. Default `Date.now`. */
  now?: () => number;
  /** Where the fake pretends the repo lives, for `html_url`s. */
  htmlBase?: string;
}

/** The step names the simulated build job walks through, in order. */
const STEPS = [
  'Set up job',
  'Checkout',
  'Build the site',
  'Deploy to GitHub Pages',
  'Complete job',
];

export interface WorkflowRunRecord {
  id: number;
  workflowFile: string;
  event: 'push' | 'workflow_dispatch';
  headBranch: string;
  headSha: string;
  createdAtMs: number;
  /** What the run will conclude with once it completes. */
  conclusion: RunConclusion;
}

interface DerivedState {
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: RunConclusion | null;
  startedAtMs: number | undefined;
  updatedAtMs: number;
  /** 0..1 through the execution phase; only meaningful while in_progress/completed. */
  fraction: number;
}

export class FakeActions {
  private readonly runs: WorkflowRunRecord[] = [];
  private nextId = 1000;
  private nextConclusion: RunConclusion = 'success';
  readonly queuedMs: number;
  readonly runMs: number;
  readonly now: () => number;
  private readonly htmlBase: string;

  constructor(options: ActionsOptions = {}) {
    this.queuedMs = options.queuedMs ?? 0;
    this.runMs = options.runMs ?? 0;
    this.now = options.now ?? (() => Date.now());
    this.htmlBase = options.htmlBase ?? 'https://github.com/fake/fake';
  }

  /** Make the NEXT run created fail (a transient Pages-deploy failure, say). */
  failNextRun(): void {
    this.nextConclusion = 'failure';
  }

  createRun(input: {
    workflowFile: string;
    event: WorkflowRunRecord['event'];
    headBranch: string;
    headSha: string;
  }): WorkflowRunRecord {
    const run: WorkflowRunRecord = {
      id: this.nextId++,
      ...input,
      createdAtMs: this.now(),
      conclusion: this.nextConclusion,
    };
    this.nextConclusion = 'success';
    this.runs.push(run);
    return run;
  }

  /** All runs, newest first (GitHub's listing order). */
  list(
    filter: { workflowFile?: string; branch?: string; status?: string } = {},
  ): WorkflowRunRecord[] {
    return this.runs
      .filter((r) => !filter.workflowFile || r.workflowFile === filter.workflowFile)
      .filter((r) => !filter.branch || r.headBranch === filter.branch)
      .filter((r) => {
        if (!filter.status) return true;
        // GitHub's `status` query accepts statuses AND conclusions (`success`, `failure`…).
        const s = this.stateOf(r);
        return s.status === filter.status || s.conclusion === filter.status;
      })
      .sort((a, b) => b.id - a.id);
  }

  get(id: number): WorkflowRunRecord | undefined {
    return this.runs.find((r) => r.id === id);
  }

  stateOf(run: WorkflowRunRecord): DerivedState {
    const elapsed = this.now() - run.createdAtMs;
    if (elapsed < this.queuedMs) {
      return {
        status: 'queued',
        conclusion: null,
        startedAtMs: undefined,
        updatedAtMs: run.createdAtMs,
        fraction: 0,
      };
    }
    const startedAtMs = run.createdAtMs + this.queuedMs;
    const running = elapsed - this.queuedMs;
    if (running < this.runMs) {
      return {
        status: 'in_progress',
        conclusion: null,
        startedAtMs,
        updatedAtMs: this.now(),
        fraction: running / this.runMs,
      };
    }
    return {
      status: 'completed',
      conclusion: run.conclusion,
      startedAtMs,
      updatedAtMs: startedAtMs + this.runMs,
      fraction: 1,
    };
  }

  /** The `workflow_runs[]` row GitHub would return for a run. */
  toApi(run: WorkflowRunRecord): Record<string, unknown> {
    const s = this.stateOf(run);
    return {
      id: run.id,
      name: 'Build & deploy site',
      path: `.github/workflows/${run.workflowFile}`,
      event: run.event,
      status: s.status,
      conclusion: s.conclusion,
      head_branch: run.headBranch,
      head_sha: run.headSha,
      html_url: `${this.htmlBase}/actions/runs/${run.id}`,
      created_at: new Date(run.createdAtMs).toISOString(),
      updated_at: new Date(s.updatedAtMs).toISOString(),
      run_started_at:
        s.startedAtMs === undefined ? null : new Date(s.startedAtMs).toISOString(),
      run_attempt: 1,
    };
  }

  /** The `jobs[]` GitHub would list for a run: one build job whose steps track progress. */
  jobsOf(run: WorkflowRunRecord): Record<string, unknown>[] {
    const s = this.stateOf(run);
    if (s.status === 'queued') return [];
    const activeIndex =
      s.status === 'completed'
        ? STEPS.length
        : Math.min(STEPS.length - 1, Math.floor(s.fraction * STEPS.length));
    return [
      {
        id: run.id * 10 + 1,
        run_id: run.id,
        name: 'build',
        status: s.status,
        conclusion: s.conclusion,
        steps: STEPS.map((name, i) => ({
          name,
          number: i + 1,
          status:
            i < activeIndex ? 'completed' : i === activeIndex ? 'in_progress' : 'queued',
          conclusion: i < activeIndex ? 'success' : null,
        })),
      },
    ];
  }
}
