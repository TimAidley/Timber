import { describe, expect, it } from 'vitest';
import type {
  ChangedPath,
  PublishSquashInput,
  RefComparison,
  RepoSnapshot,
} from '@timber/host';
import {
  catchUpWip,
  planPublish,
  runPublish,
  type PublishClient,
  type PublishContext,
} from '../src/state/publish.js';

const CTX: PublishContext = {
  wipBranch: 'octocat_wip',
  defaultBranch: 'main',
  baseSha: 'BASE',
};

const SCHEMA =
  'kind: collection\nhasBody: true\nfields:\n  title:\n    type: text\n    required: true\n';
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
  /** How WIP stands relative to main; defaults to `ahead` (WIP contains main). */
  refRelation?: RefComparison;
}

// A fake host port for the publisher. Since publish became an intent-level port op, the
// tree mechanics live in the adapter (tested in @timber/github's publish.test.ts); here
// the fake just records the PublishSquashInput so we can assert runPublish hands the plan
// to publishSquash correctly.
class FakeClient implements PublishClient {
  readonly calls = {
    publishSquash: [] as PublishSquashInput[],
    resetBranch: [] as { branch: string; toSha: string }[],
  };
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
  setBranch(branch: string, sha: string) {
    this.cfg.branches[branch] = sha;
  }
  async compareRefs(_base: string, _head: string): Promise<RefComparison> {
    return this.cfg.refRelation ?? { status: 'ahead', aheadBy: 1, behindBy: 0 };
  }
  async resetBranch(branch: string, toSha: string) {
    this.calls.resetBranch.push({ branch, toSha });
    this.cfg.branches[branch] = toSha;
  }
  async publishSquash(input: PublishSquashInput) {
    this.calls.publishSquash.push(input);
    return { sha: 'NEWMAIN' };
  }
}

describe('planPublish', () => {
  it('blocks with "nothing" when the WIP branch does not exist', async () => {
    const c = new FakeClient({
      branches: { main: 'MAIN' },
      compares: {},
      snapshot: validSnapshot,
    });
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
      compares: {
        'main...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
      },
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
      compares: {
        'main...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
      },
      snapshot: validSnapshot,
    });
    const plan = await planPublish(c, CTX);
    expect(plan.ok && plan.strategy).toBe('clean');
  });

  it('plans a rebase when main moved but changes do not overlap', async () => {
    const c = new FakeClient({
      branches: { main: 'MAIN', octocat_wip: 'WIP' }, // MAIN !== BASE
      compares: {
        'main...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
        'BASE...main': [{ path: 'content/pages/other/index.md', status: 'modified' }],
        'BASE...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
      },
      snapshot: validSnapshot,
      // main moved AND WIP has its own commits: diverged, forked at BASE.
      refRelation: { status: 'diverged', aheadBy: 1, behindBy: 1, mergeBaseSha: 'BASE' },
    });
    const plan = await planPublish(c, CTX);
    expect(plan.ok && plan.strategy).toBe('rebase');
  });

  it('blocks with "conflict" when the same file diverged on both sides', async () => {
    const c = new FakeClient({
      branches: { main: 'MAIN', octocat_wip: 'WIP' },
      compares: {
        'main...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
        'BASE...main': [{ path: 'content/pages/hello/index.md', status: 'modified' }],
        'BASE...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
      },
      snapshot: validSnapshot,
      // main moved AND WIP has its own commits: diverged, forked at BASE.
      refRelation: { status: 'diverged', aheadBy: 1, behindBy: 1, mergeBaseSha: 'BASE' },
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
      compares: {
        'main...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
      },
      snapshot: validSnapshot,
    });
    const plan = await planPublish(c, CTX);
    if (!plan.ok) throw new Error('expected a runnable plan');

    const result = await runPublish(c, CTX, plan, 'Publish');
    expect(result).toEqual({ ok: true, sha: 'NEWMAIN' });
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
        'main...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
        'BASE...main': [{ path: 'content/pages/other/index.md', status: 'modified' }],
        'BASE...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
          { path: 'content/pages/removed/index.md', status: 'removed' },
        ],
      },
      snapshot: validSnapshot,
      // main moved AND WIP has its own commits: diverged, forked at BASE.
      refRelation: { status: 'diverged', aheadBy: 1, behindBy: 1, mergeBaseSha: 'BASE' },
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

  // A plan pins the WIP tip it was made from. If a debounced autosave (or another tab)
  // lands between planning and confirming, publishing that pinned tip ships the tree
  // WITHOUT the newest commit — the site comes out a version behind and the change
  // bounces back as still-unpublished. Refuse instead, so the caller re-plans.
  it('refuses a stale plan when the WIP branch moved since planning', async () => {
    const c = new FakeClient({
      branches: { main: 'BASE', octocat_wip: 'WIP' },
      compares: {
        'main...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
      },
      snapshot: validSnapshot,
    });
    const plan = await planPublish(c, CTX);
    if (!plan.ok) throw new Error('expected a runnable plan');

    c.setBranch('octocat_wip', 'WIP2'); // the autosave commit lands
    const result = await runPublish(c, CTX, plan, 'Publish');

    expect(result).toEqual({ ok: false, reason: 'stale' });
    expect(c.calls.publishSquash).toHaveLength(0); // nothing was published

    // Re-planning against the moved branch publishes the *current* tip.
    const fresh = await planPublish(c, CTX);
    if (!fresh.ok) throw new Error('expected a runnable plan');
    expect(await runPublish(c, CTX, fresh, 'Publish')).toEqual({
      ok: true,
      sha: 'NEWMAIN',
    });
    expect(c.calls.publishSquash[0]!.wipTip).toBe('WIP2');
  });
});

/**
 * The ancestry gate. `clean` hands WIP's tree to the squash wholesale, so choosing it
 * when WIP does not contain the default branch rewrites main back to WIP's older
 * content. The old test asked "has main moved since this session loaded?" — true for
 * every fresh session, since `baseSha` is read at load — and silently reverted a pushed
 * fix five times on a live site.
 */
describe('planPublish — WIP must actually contain the default branch', () => {
  const behind: RefComparison = { status: 'behind', aheadBy: 0, behindBy: 1 };

  /** The live case: main gained a commit from a direct push; WIP has nothing of its own. */
  function behindClient(): FakeClient {
    return new FakeClient({
      // baseSha === currentMain, exactly what a fresh session sees. The old rule called
      // this "clean" and published WIP's stale tree over main.
      branches: { main: 'BASE', octocat_wip: 'OLDER' },
      compares: {
        'main...octocat_wip': [
          { path: 'themes/anatole/templates/projects.liquid', status: 'modified' },
          {
            path: 'themes/anatole/assets/_sass/partials/components/_figure.scss',
            status: 'modified',
          },
        ],
      },
      snapshot: validSnapshot,
      refRelation: behind,
    });
  }

  it('refuses to publish a WIP branch that is merely behind', async () => {
    const plan = await planPublish(behindClient(), CTX);
    expect(plan).toEqual({ ok: false, block: { kind: 'behind', behindBy: 1 } });
  });

  it('refuses when the two refs are identical, whatever the file diff claims', async () => {
    const c = new FakeClient({
      branches: { main: 'BASE', octocat_wip: 'BASE' },
      // A path diff with no commit difference means a stale read, not work to publish.
      compares: {
        'main...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
      },
      snapshot: validSnapshot,
      refRelation: { status: 'identical', aheadBy: 0, behindBy: 0 },
    });

    const plan = await planPublish(c, CTX);

    expect(plan).toEqual({ ok: false, block: { kind: 'behind', behindBy: 0 } });
  });

  it('still takes the clean path when WIP genuinely contains main', async () => {
    const c = new FakeClient({
      branches: { main: 'BASE', octocat_wip: 'WIP' },
      compares: {
        'main...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
      },
      snapshot: validSnapshot,
      refRelation: { status: 'ahead', aheadBy: 2, behindBy: 0 },
    });
    const plan = await planPublish(c, CTX);
    expect(plan.ok && plan.strategy).toBe('clean');
  });

  it('measures a diverged rebase from the merge base, not the session base', async () => {
    // `baseSha` (BASE) is stale: main has moved to FORK and beyond. Measuring WIP's
    // "changes" from BASE would count main's newer file as something WIP changed, and
    // overlay the old version back over it — the same revert by another route.
    const c = new FakeClient({
      branches: { main: 'MAIN', octocat_wip: 'WIP' },
      compares: {
        'main...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
        'FORK...main': [
          { path: 'themes/anatole/templates/projects.liquid', status: 'modified' },
        ],
        'FORK...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
        ],
        // What the stale base would have said: WIP "changed" the template too.
        'BASE...main': [
          { path: 'themes/anatole/templates/projects.liquid', status: 'modified' },
        ],
        'BASE...octocat_wip': [
          { path: 'content/pages/hello/index.md', status: 'modified' },
          { path: 'themes/anatole/templates/projects.liquid', status: 'modified' },
        ],
      },
      snapshot: validSnapshot,
      refRelation: { status: 'diverged', aheadBy: 1, behindBy: 1, mergeBaseSha: 'FORK' },
    });

    const plan = await planPublish(c, CTX);

    // From the merge base there's no overlap, so it rebases and keeps main's template.
    // From the stale base it would have been called a conflict and blocked.
    expect(plan.ok && plan.strategy).toBe('rebase');
    expect(plan.ok && plan.wipChanged.map((w) => w.path)).toEqual([
      'content/pages/hello/index.md',
    ]);
  });
});

describe('catchUpWip', () => {
  it('moves the behind WIP branch onto the default branch tip', async () => {
    const c = new FakeClient({
      branches: { main: 'NEWMAIN', octocat_wip: 'OLDER' },
      compares: {},
      snapshot: validSnapshot,
    });

    const sha = await catchUpWip(c, CTX);

    expect(sha).toBe('NEWMAIN');
    expect(c.calls.resetBranch).toEqual([{ branch: 'octocat_wip', toSha: 'NEWMAIN' }]);
  });
});
