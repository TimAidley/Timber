import { describe, expect, it } from 'vitest';
import type { ChangedPath, RepoSnapshot, RepoTree, TreeOverlayEntry } from '@timber/github';
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
  wipEntries?: RepoTree['entries'];
}

class FakeClient implements PublishClient {
  readonly calls = {
    commitTree: [] as Array<{ branch: string; treeSha: string; parents: string[] }>,
    overlayTree: [] as Array<{ base: string; entries: TreeOverlayEntry[] }>,
    resetBranch: [] as Array<{ branch: string; toSha: string }>,
  };
  constructor(private readonly cfg: FakeConfig) {}
  async getBranchSha(b: string) {
    return this.cfg.branches[b];
  }
  async compareChangedPaths(base: string, head: string) {
    return this.cfg.compares[`${base}...${head}`] ?? [];
  }
  async treeShaOf(sha: string) {
    return `${sha}-tree`;
  }
  async loadTree(ref: string): Promise<RepoTree> {
    return { ref, commitSha: '', treeSha: '', entries: this.cfg.wipEntries ?? [] };
  }
  async loadSnapshot() {
    return this.cfg.snapshot;
  }
  async overlayTree(base: string, entries: TreeOverlayEntry[]) {
    this.calls.overlayTree.push({ base, entries });
    return 'OVERLAID';
  }
  async commitTree(input: { branch: string; message: string; treeSha: string; parents: string[] }) {
    this.calls.commitTree.push({ branch: input.branch, treeSha: input.treeSha, parents: input.parents });
    return { sha: 'NEWMAIN' };
  }
  async resetBranch(branch: string, toSha: string) {
    this.calls.resetBranch.push({ branch, toSha });
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
  it('clean squash: commits WIP tree onto main and resets WIP', async () => {
    const c = new FakeClient({
      branches: { main: 'BASE', octocat_wip: 'WIP' },
      compares: { 'main...octocat_wip': [{ path: 'content/pages/hello/index.md', status: 'modified' }] },
      snapshot: validSnapshot,
    });
    const plan = await planPublish(c, CTX);
    if (!plan.ok) throw new Error('expected a runnable plan');

    const result = await runPublish(c, CTX, plan, 'Publish');
    expect(result.sha).toBe('NEWMAIN');
    expect(c.calls.commitTree).toEqual([{ branch: 'main', treeSha: 'WIP-tree', parents: ['BASE'] }]);
    expect(c.calls.resetBranch).toEqual([{ branch: 'octocat_wip', toSha: 'NEWMAIN' }]);
    expect(c.calls.overlayTree).toHaveLength(0);
  });

  it('rebase: overlays WIP changes onto main tree, commits, resets WIP', async () => {
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
      wipEntries: [
        { path: 'content/pages/hello/index.md', type: 'blob', sha: 'HELLOBLOB' },
      ],
    });
    const plan = await planPublish(c, CTX);
    if (!plan.ok) throw new Error('expected a runnable plan');

    await runPublish(c, CTX, plan, 'Publish');
    expect(c.calls.overlayTree).toHaveLength(1);
    expect(c.calls.overlayTree[0]!.base).toBe('MAIN-tree');
    // modified file overlaid with its blob; removed file deleted (sha null).
    expect(c.calls.overlayTree[0]!.entries).toEqual([
      { path: 'content/pages/hello/index.md', sha: 'HELLOBLOB' },
      { path: 'content/pages/removed/index.md', sha: null },
    ]);
    expect(c.calls.commitTree[0]!.treeSha).toBe('OVERLAID');
    expect(c.calls.resetBranch).toEqual([{ branch: 'octocat_wip', toSha: 'NEWMAIN' }]);
  });
});
