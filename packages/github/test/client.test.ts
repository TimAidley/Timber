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
});
