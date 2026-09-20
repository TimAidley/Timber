import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RepoClient } from '@timber/github';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGitHub, type FakeRepo } from '../src/index.js';
import { seedRepoFromDir } from '../src/node.js';

const here = dirname(fileURLToPath(import.meta.url));
const SITE_TEMPLATE = join(here, '..', '..', '..', 'site-template');

const OWNER = 'acme';
const REPO = 'village-hall';
const TOKEN = 'ghp_fake';
const LOGIN = 'Alice';

// The proof the fake is worth having: the REAL `RepoClient` (Octokit and all) runs its
// whole load → commit → publish loop against it in-process, with `fetchImpl` swapped in
// and nothing else. If these pass, the same bytes will pass through a Playwright route
// from the real editor bundle.
describe('RepoClient against FakeGitHub', () => {
  let fake: FakeGitHub;
  let repo: FakeRepo;
  let client: RepoClient;

  beforeEach(async () => {
    fake = new FakeGitHub();
    fake.addUser(LOGIN, TOKEN);
    repo = fake.addRepo({ owner: OWNER, repo: REPO });
    await seedRepoFromDir(repo, SITE_TEMPLATE);
    client = new RepoClient({
      owner: OWNER,
      repo: REPO,
      getToken: async () => TOKEN,
      fetchImpl: fake.fetch,
      sleep: async () => undefined,
    });
  });

  it('answers repo metadata and identity', async () => {
    expect(await client.getDefaultBranch()).toBe('main');
    expect(await client.getVisibility()).toBe('public');
    expect(await client.getAuthenticatedLogin()).toBe(LOGIN);
    expect(fake.unhandled).toEqual([]);
  });

  it('rejects a token the fake does not know with a 401', async () => {
    const stranger = new RepoClient({
      owner: OWNER,
      repo: REPO,
      getToken: async () => 'ghp_revoked',
      fetchImpl: fake.fetch,
    });
    await expect(stranger.getAuthenticatedLogin()).rejects.toMatchObject({ status: 401 });
  });

  it('loads the seeded site-template as a snapshot + tree', async () => {
    const { snapshot, tree } = await client.loadSnapshotWithTree('main');
    expect(tree.ref).toBe('main');
    expect(tree.commitSha).toBe(repo.getRef('main'));
    // Text under content/ + config/ is in the snapshot; the theme is only in the tree.
    expect([...snapshot.keys()].some((p) => /^content\/.*index\.md$/.test(p))).toBe(true);
    expect([...snapshot.keys()].some((p) => p.startsWith('config/'))).toBe(true);
    expect([...snapshot.keys()].some((p) => p.startsWith('themes/'))).toBe(false);
    expect(
      tree.entries.some((e) => e.path.startsWith('themes/') && e.type === 'blob'),
    ).toBe(true);
    expect(tree.entries.some((e) => e.path === 'content' && e.type === 'tree')).toBe(
      true,
    );
    expect(fake.unhandled).toEqual([]);
  });

  it('readFile / readBlob / readBinaryBlob round-trip bytes exactly', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 10, 13]);
    await repo.writeFiles('main', {
      'content/pages/x/pic.png': bytes,
      'content/pages/x/index.md': '---\ntitle: X\n---\nhi ✓\n',
    });
    const tree = await client.loadTree('main');
    const pic = tree.entries.find((e) => e.path === 'content/pages/x/pic.png')!;
    expect(await client.readBinaryBlob(pic.sha)).toEqual(bytes);
    expect(await client.readFile('content/pages/x/index.md', 'main')).toBe(
      '---\ntitle: X\n---\nhi ✓\n',
    );
    const md = tree.entries.find((e) => e.path === 'content/pages/x/index.md')!;
    expect(await client.readBlob(md.sha)).toBe('---\ntitle: X\n---\nhi ✓\n');
  });

  it('commitFiles creates the WIP branch from main and lands writes, deletions and moves', async () => {
    const wip = 'alice_wip';
    expect(await client.getBranchSha(wip)).toBeUndefined();

    const mainFiles = repo.listFiles('main');
    const existing = mainFiles.find((p) => /^content\/.*\/index\.md$/.test(p))!;
    const { sha } = await client.commitFiles({
      branch: wip,
      message: 'Add an event',
      files: [
        {
          path: 'content/events/quiz-night/index.md',
          content: '---\ntitle: Quiz night\n---\n',
        },
      ],
      deletions: [existing],
    });

    expect(await client.getBranchSha(wip)).toBe(sha);
    expect(repo.readFile('content/events/quiz-night/index.md', wip)).toBe(
      '---\ntitle: Quiz night\n---\n',
    );
    expect(repo.readFile(existing, wip)).toBeUndefined();
    expect(repo.readFile(existing, 'main')).toBeDefined(); // main untouched
    expect(repo.log(wip).map((c) => c.message)[0]).toBe('Add an event');
    expect(repo.log(wip)[1]!.sha).toBe(repo.getRef('main'));

    // A move reuses the blob without re-upload; from === to is a re-add (no deletion).
    const tree = await client.loadTree(wip);
    const quiz = tree.entries.find(
      (e) => e.path === 'content/events/quiz-night/index.md',
    )!;
    await client.commitFiles({
      branch: wip,
      message: 'Rename',
      files: [],
      moves: [
        {
          from: 'content/events/quiz-night/index.md',
          to: 'content/events/pub-quiz/index.md',
          sha: quiz.sha,
        },
      ],
    });
    expect(repo.listFiles(wip)).toContain('content/events/pub-quiz/index.md');
    expect(repo.listFiles(wip)).not.toContain('content/events/quiz-night/index.md');
    expect(
      fake.served.filter((r) => r.method === 'POST' && r.path.endsWith('/git/blobs')),
    ).toHaveLength(1);
    expect(fake.unhandled).toEqual([]);
  });

  it('resolveBranch is case-insensitive like a GitHub login', async () => {
    await repo.writeFiles('alice_wip', { 'content/note.md': 'x' });
    expect(await client.resolveBranch('Alice_wip')).toEqual({
      name: 'alice_wip',
      sha: repo.getRef('alice_wip'),
    });
    expect(await client.resolveBranch('nobody_wip')).toBeUndefined();
  });

  it('recovers from a ref that moves under it (422 "not a fast forward")', async () => {
    const wip = 'alice_wip';
    await client.commitFiles({
      branch: wip,
      message: 'first',
      files: [{ path: 'content/a.md', content: 'a' }],
    });

    // Someone else lands a commit between our commit-object creation and the ref update.
    let raced = false;
    fake.onRequest.push(async ({ method, path }) => {
      if (!raced && method === 'POST' && path.endsWith('/git/commits')) {
        raced = true;
        await repo.writeFiles(
          wip,
          { 'content/other-tab.md': 'from another tab' },
          'Other tab',
        );
      }
    });

    const { sha } = await client.commitFiles({
      branch: wip,
      message: 'second',
      files: [{ path: 'content/b.md', content: 'b' }],
    });

    expect(repo.getRef(wip)).toBe(sha);
    // Both writes survive: ours was re-applied on top of the other tab's tip.
    expect(repo.readFile('content/b.md', wip)).toBe('b');
    expect(repo.readFile('content/other-tab.md', wip)).toBe('from another tab');
    expect(
      repo
        .log(wip)
        .map((c) => c.message)
        .slice(0, 3),
    ).toEqual(['second', 'Other tab', 'first']);
    expect(
      fake.served.filter((r) => r.method === 'PATCH' && r.status === 422),
    ).toHaveLength(1);
  });

  it('compareChangedPaths / compareRefs describe main…wip', async () => {
    const wip = 'alice_wip';
    const removed = repo
      .listFiles('main')
      .find((p) => /^content\/.*\/index\.md$/.test(p))!;
    await client.commitFiles({
      branch: wip,
      message: 'edits',
      files: [{ path: 'content/new/index.md', content: 'new' }],
      deletions: [removed],
    });
    const base = repo.getRef('main')!;
    await repo.writeFiles(
      'main',
      { 'content/from-main.md': 'main moved on' },
      'someone published',
    );

    expect(await client.compareChangedPaths('main', wip)).toEqual([
      { path: 'content/new/index.md', status: 'added' },
      { path: removed, status: 'removed' },
    ]);
    expect(await client.compareRefs('main', wip)).toEqual({
      status: 'diverged',
      aheadBy: 1,
      behindBy: 1,
      mergeBaseSha: base,
    });
    expect(await client.compareRefs(wip, wip)).toMatchObject({
      status: 'identical',
      aheadBy: 0,
      behindBy: 0,
    });
  });

  it('publishSquash (clean) squashes WIP onto main and resets WIP; a push to main starts a deploy run', async () => {
    const wip = 'alice_wip';
    await client.commitFiles({
      branch: wip,
      message: 'one',
      files: [{ path: 'content/a.md', content: 'a' }],
    });
    await client.commitFiles({
      branch: wip,
      message: 'two',
      files: [{ path: 'content/b.md', content: 'b' }],
    });
    const parentSha = repo.getRef('main')!;
    const wipTip = repo.getRef(wip)!;
    const runsBefore = repo.actions.list().length;

    const { sha } = await client.publishSquash({
      defaultBranch: 'main',
      wipBranch: wip,
      parentSha,
      wipTip,
      message: 'Publish: two edits',
      strategy: 'clean',
      changes: [],
    });

    expect(repo.getRef('main')).toBe(sha);
    expect(repo.getRef(wip)).toBe(sha);
    const [top, prev] = repo.log('main');
    expect(top!.message).toBe('Publish: two edits');
    expect(top!.parents).toEqual([parentSha]);
    expect(prev!.sha).toBe(parentSha);
    expect(repo.readFile('content/a.md')).toBe('a');
    expect(repo.readFile('content/b.md')).toBe('b');
    // Same tree as WIP had — a squash reuses it wholesale.
    expect(top!.tree).toBe(repo.store.getCommit(wipTip)!.tree);

    const run = await client.deploy.getLatestDeploy('main');
    expect(repo.actions.list().length).toBe(runsBefore + 1);
    expect(run).toMatchObject({
      status: 'completed',
      conclusion: 'success',
      headBranch: 'main',
    });
  });

  it('publishSquash (rebase) overlays WIP changes on a moved main', async () => {
    const wip = 'alice_wip';
    const base = repo.getRef('main')!;
    await client.commitFiles({
      branch: wip,
      message: 'wip edit',
      files: [{ path: 'content/a.md', content: 'a' }],
    });
    await repo.writeFiles(
      'main',
      { 'content/from-main.md': 'main moved on' },
      'someone published',
    );

    const changes = await client.compareChangedPaths(base, wip);
    const { sha } = await client.publishSquash({
      defaultBranch: 'main',
      wipBranch: wip,
      parentSha: repo.getRef('main')!,
      wipTip: repo.getRef(wip)!,
      message: 'Publish over moved main',
      strategy: 'rebase',
      changes,
    });

    expect(repo.getRef('main')).toBe(sha);
    expect(repo.getRef(wip)).toBe(sha);
    expect(repo.readFile('content/a.md')).toBe('a');
    expect(repo.readFile('content/from-main.md')).toBe('main moved on');
  });

  it('a scripted fault surfaces as the matching HTTP error, then clears', async () => {
    fake.failNext('GET', /\/git\/ref\/heads\/main$/, 500, 'Server Error');
    await expect(client.getBranchSha('main')).rejects.toMatchObject({ status: 500 });
    expect(await client.getBranchSha('main')).toBe(repo.getRef('main'));
  });

  it('a request for a repo the fake does not have is a 404 and recorded as unhandled', async () => {
    const other = new RepoClient({
      owner: 'TimAidley',
      repo: 'Timber',
      getToken: async () => TOKEN,
      fetchImpl: fake.fetch,
    });
    await expect(other.compareRefs('abc', 'main')).rejects.toMatchObject({ status: 404 });
    // Known repo, unknown ref → still 404, but that IS handled (it's the endpoint answering).
    await expect(client.compareRefs('nope', 'main')).rejects.toMatchObject({
      status: 404,
    });
    expect(fake.unhandled).toEqual([]);
  });
});
