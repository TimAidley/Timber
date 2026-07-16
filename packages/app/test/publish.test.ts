import { describe, expect, it } from 'vitest';
import type { ChangedPath, PublishSquashInput, RepoSnapshot } from '@timber/host';
import { planPublish, runPublish, type PublishClient, type PublishContext } from '../src/state/publish.js';

const CTX: PublishContext = { wipBranch: 'octocat_wip', defaultBranch: 'main', baseSha: 'BASE' };

const SCHEMA = 'kind: collection\nhasBody: true\nfields:\n  title:\n    type: text\n    required: true\n';
const validSnapshot: RepoSnapshot = new Map([
  ['config/schemas/pages.yml', SCHEMA],
  ['content/pages/hello/index.md', '---\ntitle: Hello\npublic: true\n---\n\nbody\n'],
]);
const invalidSnapshot: RepoSnapshot = new Map([
  ['config/schemas/pages.yml', SCHEMA],
  // public but missing required `title` → cannot be published
  ['content/pages/hello/index.md', '---\npublic: true\n---\n\nbody\n'],
]);

interface FakeConfig {
  branches: Record<string, string | undefined>;
  compares: Record<string, ChangedPath[]>;
  snapshot: RepoSnapshot;
}

// A fake host port for the publisher. Since publish became an intent-level port op, the
// tree mechanics live in the adapter (tested in @timber/github's publish.test.ts); here
// the fake just records the PublishSquashInput so we can assert runPublish hands the plan
// to publishSquash correctly.
class FakeClient implements PublishClient {
  readonly calls = { publishSquash: [] as PublishSquashInput[] };
  constructor(private readonly cfg: FakeConfig) {}
  async getBranchSha(b: string) {
    return this.cfg.branches[b];
  }
  async compareChangedPaths(base: string, head: string) {
    return this.cfg.compares[`${base}...${head}`] ?? [];
  }
  async loadSnapshot() {
    return this.cfg.snapshot;
  }
  async publishSquash(input: PublishSquashInput) {
    this.calls.publishSquash.push(input);
    return { sha: 'NEWMAIN' };
  }
}

describe('planPublish', () => {
  it('blocks with "nothing" when the WIP branch does not exist', async () => {
    const c = new FakeClient({ branches: { main: 'MAIN' }, compares: {}, snapshot: validSnapshot });
    const plan = await planPublish(c, CTX);
    expect(plan).toEqual({ ok: false, block: { kind: 'nothing' } });
  });

  it('blocks with "nothing" when there are no changes to publish', async () => {
    const c = new FakeClient({
      branches: { main: 'MAIN', octocat_wip: 'WIP' },
      compares: { 'main...octocat_wip': [] },
      snapshot: validSnapshot,
    });
    expect((await planPublish(c, CTX)).ok).toBe(false);
  });

  it('blocks publishing an invalid public object (validity gate)', async () => {
    const c = new FakeClient({
      branches: { main: 'MAIN', octocat_wip: 'WIP' },
      compares: { 'main...octocat_wip': [{ path: 'content/pages/hello/index.md', status: 'modified' }] },
      snapshot: invalidSnapshot,
    });
    const plan = await planPublish(c, CTX);
    expect(plan).toEqual({
      ok: false,
      block: { kind: 'invalid', objects: ['content/pages/hello/index.md'] },
    });
  });

  it('plans a clean squash when main has not moved', async () => {
    const c = new FakeClient({
      branches: { main: 'BASE', octocat_wip: 'WIP' }, // main tip === baseSha
      compares: { 'main...octocat_wip': [{ path: 'content/pages/hello/index.md', status: 'modified' }] },
      snapshot: validSnapshot,
    });
    const plan = await planPublish(c, CTX);
    expect(plan.ok && plan.strategy).toBe('clean');
  });

  it('plans a rebase when main moved but changes do not overlap', async () => {
    const c = new FakeClient({
      branches: { main: 'MAIN', octocat_wip: 'WIP' }, // MAIN !== BASE
      compares: {
        'main...octocat_wip': [{ path: 'content/pages/hello/index.md', status: 'modified' }],
        'BASE...main': [{ path: 'content/pages/other/index.md', status: 'modified' }],
        'BASE...octocat_wip': [{ path: 'content/pages/hello/index.md', status: 'modified' }],
      },
      snapshot: validSnapshot,
    });
    const plan = await planPublish(c, CTX);
    expect(plan.ok && plan.strategy).toBe('rebase');
  });

  it('blocks with "conflict" when the same file diverged on both sides', async () => {
    const c = new FakeClient({
      branches: { main: 'MAIN', octocat_wip: 'WIP' },
      compares: {
        'main...octocat_wip': [{ path: 'content/pages/hello/index.md', status: 'modified' }],
        'BASE...main': [{ path: 'content/pages/hello/index.md', status: 'modified' }],
        'BASE...octocat_wip': [{ path: 'content/pages/hello/index.md', status: 'modified' }],
      },
      snapshot: validSnapshot,
    });
    const plan = await planPublish(c, CTX);
    expect(plan).toEqual({
      ok: false,
      block: { kind: 'conflict', paths: ['content/pages/hello/index.md'] },
    });
  });
});

describe('runPublish', () => {
  it('clean squash: hands publishSquash a clean plan (WIP tip onto unmoved main)', async () => {
    const c = new FakeClient({
      branches: { main: 'BASE', octocat_wip: 'WIP' },
      compares: { 'main...octocat_wip': [{ path: 'content/pages/hello/index.md', status: 'modified' }] },
      snapshot: validSnapshot,
    });
    const plan = await planPublish(c, CTX);
    if (!plan.ok) throw new Error('expected a runnable plan');

    const result = await runPublish(c, CTX, plan, 'Publish');
    expect(result.sha).toBe('NEWMAIN');
    expect(c.calls.publishSquash).toHaveLength(1);
    expect(c.calls.publishSquash[0]).toEqual({
      defaultBranch: 'main',
      wipBranch: 'octocat_wip',
      parentSha: 'BASE', // main tip (unmoved)
      wipTip: 'WIP',
      message: 'Publish',
      strategy: 'clean',
      changes: [{ path: 'content/pages/hello/index.md', status: 'modified' }],
    });
  });

  it('rebase: hands publishSquash a rebase plan with WIP-since-base changes', async () => {
    const c = new FakeClient({
      branches: { main: 'MAIN', octocat_wip: 'WIP' },
      compares: {
        'main...octocat_wip': [{ path: 'content/pages/hello/index.md', status: 'modified' }],
        'BASE...main': [{ path: 'content/pages/other/index.md', status: 'modified' }],
        'BASE...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
          { path: 'content/pages/removed/index.md', status: 'removed' },
        ],
      },
      snapshot: validSnapshot,
    });
    const plan = await planPublish(c, CTX);
    if (!plan.ok) throw new Error('expected a runnable plan');

    await runPublish(c, CTX, plan, 'Publish');
    expect(c.calls.publishSquash).toHaveLength(1);
    const input = c.calls.publishSquash[0]!;
    expect(input.strategy).toBe('rebase');
    expect(input.parentSha).toBe('MAIN'); // the moved main tip
    expect(input.defaultBranch).toBe('main');
    expect(input.wipBranch).toBe('octocat_wip');
    // The overlay set is WIP's changes since the conflict base, incl. the removal.
    expect(input.changes).toEqual([
      { path: 'content/pages/hello/index.md', status: 'modified' },
      { path: 'content/pages/removed/index.md', status: 'removed' },
    ]);
  });
});
