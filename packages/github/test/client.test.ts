import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { RepoClient } from '../src/index.js';
import { createCassetteServer, type Cassette } from './support/cassette.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'github');

function loadCassette(name: string): Cassette {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as Cassette;
}

const OWNER = 'TimAidley';
const REPO = 'Timber-test-sandbox';
const FAKE_TOKEN = 'fake-test-token';

function makeClient(getToken = async () => FAKE_TOKEN): RepoClient {
  return new RepoClient({ owner: OWNER, repo: REPO, getToken });
}

// Each test spins up its own msw server bound to one recorded cassette and tears
// it down afterwards, so tests never leak mock state into one another.
let activeServer: ReturnType<typeof createCassetteServer>['server'] | undefined;

afterEach(() => {
  activeServer?.close();
  activeServer = undefined;
});

function useCassette(name: string) {
  const cassette = loadCassette(name);
  const built = createCassetteServer(cassette);
  activeServer = built.server;
  built.server.listen({ onUnhandledRequest: 'error' });
  return built;
}

describe('RepoClient (replayed from fixtures recorded against the real sandbox repo)', () => {
  it('getDefaultBranch() resolves the repo default branch', async () => {
    const { served, isExhausted } = useCassette('get-default-branch');

    const branch = await makeClient().getDefaultBranch();

    expect(branch).toBe('main');
    expect(isExhausted()).toBe(true);
    expect(served.every((r) => r.authorization === `Bearer ${FAKE_TOKEN}`)).toBe(true);
  });

  it('getVisibility() maps the repo private flag (public sandbox)', async () => {
    // Same GET /repos/{owner}/{repo} the default-branch call uses; the recorded response
    // has "private": false → public.
    useCassette('get-default-branch');

    expect(await makeClient().getVisibility()).toBe('public');
  });

  it('loadTree() returns the recorded tree shape', async () => {
    useCassette('load-tree');

    const tree = await makeClient().loadTree('main');

    expect(tree.ref).toBe('main');
    expect(
      tree.entries.some(
        (e) => e.path === 'content/pages/hello/index.md' && e.type === 'blob',
      ),
    ).toBe(true);
    expect(tree.entries.some((e) => e.path === 'templates' && e.type === 'tree')).toBe(true);
  });

  it('loadTree() is fully exhausted after one call (no stray requests)', async () => {
    const { isExhausted } = useCassette('load-tree');
    await makeClient().loadTree('main');
    expect(isExhausted()).toBe(true);
  });

  it('readFile() decodes the recorded blob content', async () => {
    useCassette('read-file');

    const content = await makeClient().readFile('content/pages/hello/index.md', 'main');

    expect(content).toContain('placeholder page');
  });

  it('commitFiles() on an existing branch does not create a new ref', async () => {
    const { served, isExhausted } = useCassette('commit-files-existing-branch');

    const result = await makeClient().commitFiles({
      branch: 'phase2-existing',
      message: 'test(github): recorded fixture commit (existing branch)',
      files: [
        { path: 'content/pages/hello/index.md', content: 'Recorded fixture content A.\n' },
        { path: 'content/pages/new/index.md', content: 'Recorded fixture content B.\n' },
      ],
    });

    expect(result.sha).toBeTruthy();
    expect(served.some((r) => r.method === 'POST' && r.pathname.endsWith('/git/refs'))).toBe(
      false,
    );
    expect(isExhausted()).toBe(true);
  });

  it('commitFiles() retries on a non-fast-forward ref race, rebuilding on the moved tip', async () => {
    // First updateRef is rejected 422 "not a fast forward" (the branch tip moved
    // since we read it — a second editor tab, or the refs read lagging just after a
    // prior autosave). The client must re-read the tip and re-apply its overlay on
    // top of it, landing the commit without forcing.
    const { served, isExhausted } = useCassette('commit-retry-non-ff');

    const result = await makeClient().commitFiles({
      branch: 'retry_wip',
      message: 'edit page',
      files: [{ path: 'content/pages/home/index.md', content: 'Edited.\n' }],
    });

    // Returns the SECOND commit — the one built on the moved tip and accepted.
    expect(result.sha).toBe('c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2');
    // Two ref updates were attempted (the 422, then the success)…
    expect(served.filter((r) => r.method === 'PATCH').length).toBe(2);
    // …and the branch tip was re-read after the failure (2 GET ref calls).
    expect(served.filter((r) => r.method === 'GET' && r.pathname.includes('/git/ref/')).length).toBe(2);
    // The blob is uploaded only ONCE and reused across the retry.
    expect(served.filter((r) => r.method === 'POST' && r.pathname.endsWith('/git/blobs')).length).toBe(1);
    expect(isExhausted()).toBe(true);
  });

  it('commitFiles() targeting a missing branch creates it from the base branch first', async () => {
    const { served, isExhausted } = useCassette('commit-files-new-branch');

    const result = await makeClient().commitFiles({
      branch: 'phase2-new-branch-fixture',
      baseBranch: 'main',
      message: 'test(github): recorded fixture commit (new branch)',
      files: [{ path: 'content/pages/hello/index.md', content: 'Recorded fixture content C.\n' }],
    });

    expect(result.sha).toBeTruthy();
    expect(served.some((r) => r.method === 'POST' && r.pathname.endsWith('/git/refs'))).toBe(
      true,
    );
    expect(isExhausted()).toBe(true);
  });

  it('surfaces a getToken() rejection without making any request', async () => {
    const { served } = useCassette('get-default-branch');
    const client = makeClient(async () => {
      throw new Error('no token available');
    });

    await expect(client.getDefaultBranch()).rejects.toThrow('no token available');
    expect(served).toHaveLength(0);
  });

  // --- Phase 5a additions ---

  it('readBlob() decodes a blob by SHA', async () => {
    useCassette('read-blob');
    const text = await makeClient().readBlob('blobsha1');
    expect(text).toBe('hello world\n');
  });

  it('getAuthenticatedLogin() returns the login (for the <login>_wip branch)', async () => {
    useCassette('get-authenticated-login');
    expect(await makeClient().getAuthenticatedLogin()).toBe('octocat');
  });

  it('resolveBranch() returns an exact match without listing branches', async () => {
    const { served, isExhausted } = useCassette('resolve-branch-exact');

    const resolved = await makeClient().resolveBranch('TimAidley_wip');

    expect(resolved).toEqual({ name: 'TimAidley_wip', sha: 'EXACTSHA' });
    // Exact hit on the first getRef — the /branches list is never fetched.
    expect(served.some((r) => r.pathname.endsWith('/branches'))).toBe(false);
    expect(isExhausted()).toBe(true);
  });

  it('resolveBranch() finds a differently-cased branch (TimAidley_wip → timaidley_wip)', async () => {
    const { isExhausted } = useCassette('resolve-branch-case-insensitive');

    // GitHub returns the canonical login casing, so we look up `TimAidley_wip`; the branch
    // was created lowercase. resolveBranch must still find it and return its ACTUAL name.
    const resolved = await makeClient().resolveBranch('TimAidley_wip');

    expect(resolved).toEqual({ name: 'timaidley_wip', sha: 'WIPSHA' });
    expect(isExhausted()).toBe(true);
  });

  it('resolveBranch() returns undefined when no branch matches even case-insensitively', async () => {
    const { isExhausted } = useCassette('resolve-branch-missing');

    expect(await makeClient().resolveBranch('TimAidley_wip')).toBeUndefined();
    expect(isExhausted()).toBe(true);
  });

  it('loadSnapshot() fetches only content/config text files into a path->utf8 map', async () => {
    const { isExhausted } = useCassette('load-snapshot');

    const snapshot = await makeClient().loadSnapshot('main');

    expect([...snapshot.keys()].sort()).toEqual([
      'config/schemas/pages.yml',
      'content/pages/hello/index.md',
    ]);
    expect(snapshot.get('content/pages/hello/index.md')).toBe('# Hello\n');
    expect(snapshot.get('config/schemas/pages.yml')).toBe('kind: collection\n');
    // The binary asset (assets/logo.png) is never fetched.
    expect(snapshot.has('assets/logo.png')).toBe(false);
    expect(isExhausted()).toBe(true);
  });

  it('commitFiles() base64-encodes a binary file (processed image) in one commit', async () => {
    const { served, isExhausted } = useCassette('commit-binary');

    const result = await makeClient().commitFiles({
      branch: 'octocat_wip',
      message: 'edit summer-fete',
      files: [{ path: 'content/events/x/images/p.webp', bytes: new Uint8Array([1, 2, 3, 4]) }],
    });

    expect(result.sha).toBe('CN');
    // The cassette asserts the blob POST body was { content: 'AQIDBA==', encoding: 'base64' };
    // reaching PATCH .../git/refs proves the whole binary commit path ran.
    expect(served.some((r) => r.method === 'PATCH' && r.pathname.includes('/git/refs/'))).toBe(true);
    expect(isExhausted()).toBe(true);
  });

  it('commitFiles() deletes paths (sha: null) alongside a write in one commit', async () => {
    const { isExhausted } = useCassette('commit-delete');

    const result = await makeClient().commitFiles({
      branch: 'octocat_wip',
      message: 'edit kept, delete gone',
      files: [{ path: 'content/events/kept/index.md', content: 'updated body\n' }],
      deletions: ['content/events/gone/index.md', 'content/events/gone/hero.webp'],
    });

    // The cassette asserts the createTree body carried the write + two sha:null
    // entries; reaching PATCH proves the whole delete-in-commit path ran.
    expect(result.sha).toBe('DELCOMMIT');
    expect(isExhausted()).toBe(true);
  });

  it('commitFiles() commits a delete-only change (no blobs created)', async () => {
    const { served, isExhausted } = useCassette('commit-delete-only');

    const result = await makeClient().commitFiles({
      branch: 'octocat_wip',
      message: 'delete gone',
      files: [],
      deletions: ['content/events/gone/index.md'],
    });

    expect(result.sha).toBe('DELCOMMIT');
    // No blob POST when there are no file writes — only the sha:null tree entry.
    expect(served.some((r) => r.method === 'POST' && r.pathname.endsWith('/git/blobs'))).toBe(false);
    expect(isExhausted()).toBe(true);
  });

  it('commitFiles() moves a bundle by reusing blob SHAs (rename, SPEC §5)', async () => {
    const { isExhausted } = useCassette('commit-move');

    const result = await makeClient().commitFiles({
      branch: 'octocat_wip',
      message: 'rename new-slug',
      // index.md is rewritten (content changes: the appended alias) at the new path…
      files: [
        {
          path: 'content/events/new-slug/index.md',
          content: '---\nid: ev\ntitle: Ren\naliases:\n  - old-slug\n---\nbody\n',
        },
      ],
      // …the colocated asset moves by reusing its existing blob SHA (no re-upload)…
      moves: [{ from: 'content/events/old-slug/hero.webp', to: 'content/events/new-slug/hero.webp', sha: 'ASSETSHA' }],
      // …and the old index.md is removed.
      deletions: ['content/events/old-slug/index.md'],
    });

    // The cassette asserts createTree carried new-path@sha for both the rewritten md
    // and the moved asset, plus old-path@null for both.
    expect(result.sha).toBe('MOVECOMMIT');
    expect(isExhausted()).toBe(true);
  });

  it('commitFiles() re-adds a bundle asset via a self-move (restore, no deletion)', async () => {
    // Restoring a deleted bundle re-writes index.md and re-attaches its colocated
    // assets by **reusing their blob SHAs** — expressed as a move with from === to.
    // The cassette asserts createTree carries the asset at its own path with NO
    // sha:null deletion entry (a plain move would have emitted one).
    const { isExhausted } = useCassette('commit-restore-self-move');

    const result = await makeClient().commitFiles({
      branch: 'octocat_wip',
      message: 'restore gone',
      files: [{ path: 'content/events/gone/index.md', content: 'restored body\n' }],
      moves: [
        {
          from: 'content/events/gone/hero.webp',
          to: 'content/events/gone/hero.webp',
          sha: 'ASSETSHA',
        },
      ],
    });

    expect(result.sha).toBe('RESTORECOMMIT');
    expect(isExhausted()).toBe(true);
  });

  // --- Phase 5b: publish / merge primitives ---

  it('compareChangedPaths() returns the changed files (publish diff / overlap check)', async () => {
    useCassette('compare-changed-paths');
    const changed = await makeClient().compareChangedPaths('main', 'octocat_wip');
    expect(changed).toEqual([
      { path: 'content/pages/hello/index.md', status: 'modified' },
      { path: 'content/events/fete/index.md', status: 'added' },
    ]);
  });

  it('compareRefs() reports how far the followed ref is ahead of our build', async () => {
    const { isExhausted } = useCassette('compare-refs');
    const cmp = await makeClient().compareRefs('BUILTSHA', 'main');
    expect(cmp).toEqual({ status: 'ahead', aheadBy: 3, behindBy: 0 });
    expect(isExhausted()).toBe(true);
  });

  it('treeShaOf() resolves a commit tree SHA (the squash source)', async () => {
    useCassette('tree-sha-of');
    expect(await makeClient().treeShaOf('WIPTIP')).toBe('WIPTREE');
  });

  it('overlayTree() builds createTree with base_tree + entries (incl. deletion)', async () => {
    const { isExhausted } = useCassette('overlay-tree');
    const sha = await makeClient().overlayTree('MAINTREE', [
      { path: 'content/pages/hello/index.md', sha: 'WIPBLOB' },
      { path: 'content/pages/gone/index.md', sha: null },
    ]);
    expect(sha).toBe('OVERLAID');
    expect(isExhausted()).toBe(true);
  });

  it('commitTree() squashes an existing tree onto a branch (createCommit + updateRef)', async () => {
    const { isExhausted } = useCassette('commit-tree');
    const result = await makeClient().commitTree({
      branch: 'main',
      message: 'Publish',
      treeSha: 'WIPTREE',
      parents: ['MAINSHA'],
    });
    expect(result.sha).toBe('SQUASHSHA');
    expect(isExhausted()).toBe(true);
  });

  it('resetBranch() force-updates a ref (reset WIP after publish)', async () => {
    const { isExhausted } = useCassette('reset-branch');
    await makeClient().resetBranch('octocat_wip', 'SQUASHSHA');
    expect(isExhausted()).toBe(true);
  });

  it('getLatestWorkflowRun() returns the latest run (deploy-status indicator)', async () => {
    useCassette('workflow-runs');
    const run = await makeClient().getLatestWorkflowRun('deploy.yml', 'main');
    expect(run?.status).toBe('in_progress');
    expect(run?.conclusion).toBeNull();
    expect(run?.url).toContain('/actions/runs/42');
  });

  it('dispatchWorkflow() triggers a workflow_dispatch on a branch (deploy retry)', async () => {
    // After a transient Pages-deploy failure the publish already landed on main, so the
    // editor re-runs the deploy rather than re-publishing. The cassette asserts the POST
    // hits the workflow's /dispatches endpoint with { ref }.
    const { served, isExhausted } = useCassette('dispatch-workflow');

    await makeClient().dispatchWorkflow('deploy.yml', 'main');

    expect(
      served.some((r) => r.method === 'POST' && r.pathname.endsWith('/deploy.yml/dispatches')),
    ).toBe(true);
    expect(isExhausted()).toBe(true);
  });
});
