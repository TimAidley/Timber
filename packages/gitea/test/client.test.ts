import { describe, expect, it } from 'vitest';
import { GiteaClient, type FetchLike } from '../src/index.js';
import { utf8ToBase64 } from '../src/base64.js';

const BASE = 'https://codeberg.org';
const API = `${BASE}/api/v1`;

interface RecordedRequest {
  method: string;
  path: string; // path after /api/v1
  body?: unknown;
}

/** A route table keyed by `METHOD /path` (query string ignored for matching). */
type Routes = Record<
  string,
  (req: RecordedRequest) => { status?: number; json?: unknown }
>;

/** Build a fake `fetch` from a route table, recording every request it receives. */
function fakeFetch(routes: Routes): { fetchImpl: FetchLike; log: RecordedRequest[] } {
  const log: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const full = url.startsWith(API) ? url.slice(API.length) : url;
    const path = full.split('?')[0]!;
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    log.push({ method, path, body });
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response('not found', { status: 404 });
    const { status = 200, json } = handler({ method, path, body });
    return new Response(json === undefined ? '' : JSON.stringify(json), { status });
  };
  return { fetchImpl, log };
}

function client(routes: Routes): { c: GiteaClient; log: RecordedRequest[] } {
  const { fetchImpl, log } = fakeFetch(routes);
  const c = new GiteaClient({
    apiBaseUrl: BASE,
    owner: 'jane',
    repo: 'site',
    getToken: async () => 'TOKEN',
    fetchImpl,
  });
  return { c, log };
}

describe('GiteaClient — reads', () => {
  it('getDefaultBranch reads default_branch', async () => {
    const { c } = client({
      'GET /repos/jane/site': () => ({ json: { default_branch: 'main' } }),
    });
    expect(await c.getDefaultBranch()).toBe('main');
  });

  it('getVisibility maps private -> private, false -> public, missing -> unknown', async () => {
    const priv = client({ 'GET /repos/jane/site': () => ({ json: { private: true } }) });
    expect(await priv.c.getVisibility()).toBe('private');

    const pub = client({ 'GET /repos/jane/site': () => ({ json: { private: false } }) });
    expect(await pub.c.getVisibility()).toBe('public');

    const missing = client({
      'GET /repos/jane/site': () => ({ json: { name: 'site' } }),
    });
    expect(await missing.c.getVisibility()).toBe('unknown');
  });

  it('getBranchSha returns the tip, or undefined on 404', async () => {
    const { c } = client({
      'GET /repos/jane/site/branches/main': () => ({
        json: { commit: { id: 'MAINSHA' } },
      }),
      'GET /repos/jane/site/branches/nope': () => ({ status: 404 }),
    });
    expect(await c.getBranchSha('main')).toBe('MAINSHA');
    expect(await c.getBranchSha('nope')).toBeUndefined();
  });

  it('loadTree resolves the commit tree and paginates entries', async () => {
    const { c } = client({
      'GET /repos/jane/site/branches/main': () => ({ json: { commit: { id: 'C1' } } }),
      'GET /repos/jane/site/git/commits/C1': () => ({
        json: { commit: { tree: { sha: 'T1' } } },
      }),
      'GET /repos/jane/site/git/trees/T1': () => ({ json: treePage() }),
    });
    const tree = await c.loadTree('main');
    expect(tree.commitSha).toBe('C1');
    expect(tree.treeSha).toBe('T1');
    expect(tree.entries.map((e) => e.path)).toEqual([
      'content/pages/home/index.md',
      'content/pages/home/hero.webp',
      'config/schemas/pages.yml',
    ]);
  });

  it('loadSnapshotWithTree keeps only content/config text files', async () => {
    const { c } = client(singleTreeRepo());
    const { snapshot } = await c.loadSnapshotWithTree('main');
    expect([...snapshot.keys()].sort()).toEqual([
      'config/schemas/pages.yml',
      'content/pages/home/index.md',
    ]);
    expect(snapshot.get('content/pages/home/index.md')).toBe('BODY');
  });
});

describe('GiteaClient — commitFiles maps to ChangeFiles', () => {
  it('classifies create vs update (with sha) and a deletion, on an existing branch', async () => {
    const { c, log } = client(singleTreeRepo());
    await c.commitFiles({
      branch: 'main',
      message: 'edit',
      files: [
        { path: 'content/pages/home/index.md', content: 'NEW BODY' }, // exists → update
        { path: 'content/pages/new/index.md', content: 'BRAND NEW' }, // absent → create
      ],
      deletions: ['config/schemas/pages.yml'], // exists → delete
    });
    const post = log.find(
      (r) => r.method === 'POST' && r.path === '/repos/jane/site/contents',
    );
    expect(post).toBeDefined();
    const body = post!.body as { branch: string; new_branch?: string; files: unknown[] };
    expect(body.branch).toBe('main');
    expect(body.new_branch).toBeUndefined();
    expect(body.files).toEqual([
      {
        operation: 'update',
        path: 'content/pages/home/index.md',
        content: utf8ToBase64('NEW BODY'),
        sha: 'BLOB_INDEX',
      },
      {
        operation: 'create',
        path: 'content/pages/new/index.md',
        content: utf8ToBase64('BRAND NEW'),
      },
      { operation: 'delete', path: 'config/schemas/pages.yml', sha: 'BLOB_SCHEMA' },
    ]);
  });

  it('creates a missing branch from the base via new_branch', async () => {
    const routes = singleTreeRepo();
    routes['GET /repos/jane/site/branches/jane_wip'] = () => ({ status: 404 }); // WIP absent
    const { c, log } = client(routes);
    await c.commitFiles({
      branch: 'jane_wip',
      baseBranch: 'main',
      message: 'first wip commit',
      files: [{ path: 'content/pages/new/index.md', content: 'X' }],
    });
    const body = log.find((r) => r.method === 'POST')!.body as {
      branch: string;
      new_branch?: string;
    };
    expect(body.branch).toBe('main'); // classify + start from base
    expect(body.new_branch).toBe('jane_wip'); // ChangeFiles creates it
  });
});

describe('GiteaClient — compareChangedPaths diffs trees', () => {
  it('reports added / modified / removed by path+sha', async () => {
    // base tree: A(sha1), B(sha2). head tree: A(sha1b changed), C(new). → A modified, C added, B removed.
    const routes: Routes = {
      'GET /repos/jane/site/branches/main': () => ({ json: { commit: { id: 'MAIN' } } }),
      'GET /repos/jane/site/branches/jane_wip': () => ({
        json: { commit: { id: 'WIP' } },
      }),
      'GET /repos/jane/site/git/commits/MAIN': () => ({
        json: { commit: { tree: { sha: 'TM' } } },
      }),
      'GET /repos/jane/site/git/commits/WIP': () => ({
        json: { commit: { tree: { sha: 'TW' } } },
      }),
      'GET /repos/jane/site/git/trees/TM': () => ({
        json: {
          total_count: 2,
          tree: [
            { path: 'a.md', type: 'blob', sha: 'sha1' },
            { path: 'b.md', type: 'blob', sha: 'sha2' },
          ],
        },
      }),
      'GET /repos/jane/site/git/trees/TW': () => ({
        json: {
          total_count: 2,
          tree: [
            { path: 'a.md', type: 'blob', sha: 'sha1b' },
            { path: 'c.md', type: 'blob', sha: 'sha3' },
          ],
        },
      }),
    };
    const { c } = client(routes);
    const changed = await c.compareChangedPaths('main', 'jane_wip');
    expect(changed.sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: 'a.md', status: 'modified' },
      { path: 'b.md', status: 'removed' },
      { path: 'c.md', status: 'added' },
    ]);
  });
});

describe('GiteaClient — publishSquash replays onto main then resets WIP', () => {
  it('applies WIP changes as one ChangeFiles commit and force-resets WIP', async () => {
    const routes: Routes = {
      // main tree has the file being modified (BLOB_OLD) so it classifies as update.
      'GET /repos/jane/site/branches/main': () => ({ json: { commit: { id: 'MAIN' } } }),
      'GET /repos/jane/site/git/commits/MAIN': () => ({
        json: { commit: { tree: { sha: 'TM' } } },
      }),
      'GET /repos/jane/site/git/trees/TM': () => ({
        json: {
          total_count: 2,
          tree: [
            { path: 'content/pages/home/index.md', type: 'blob', sha: 'BLOB_OLD' },
            { path: 'content/pages/gone/index.md', type: 'blob', sha: 'BLOB_GONE' },
          ],
        },
      }),
      // WIP content for the changed file.
      'GET /repos/jane/site/contents/content/pages/home/index.md': () => ({
        json: { type: 'file', content: utf8ToBase64('WIP BODY') },
      }),
      'POST /repos/jane/site/contents': () => ({ json: { commit: { sha: 'NEWMAIN' } } }),
      'PATCH /repos/jane/site/git/refs/heads/jane_wip': () => ({ json: {} }),
    };
    const { c, log } = client(routes);
    const res = await c.publishSquash({
      defaultBranch: 'main',
      wipBranch: 'jane_wip',
      parentSha: 'MAIN',
      wipTip: 'WIP',
      message: 'Publish',
      strategy: 'clean',
      changes: [
        { path: 'content/pages/home/index.md', status: 'modified' },
        { path: 'content/pages/gone/index.md', status: 'removed' },
      ],
    });
    expect(res.sha).toBe('NEWMAIN');

    const post = log.find((r) => r.method === 'POST')!.body as {
      branch: string;
      files: unknown[];
    };
    expect(post.branch).toBe('main');
    expect(post.files).toEqual([
      {
        operation: 'update',
        path: 'content/pages/home/index.md',
        content: utf8ToBase64('WIP BODY'),
        sha: 'BLOB_OLD',
      },
      { operation: 'delete', path: 'content/pages/gone/index.md', sha: 'BLOB_GONE' },
    ]);

    const patch = log.find((r) => r.method === 'PATCH')!;
    expect(patch.path).toBe('/repos/jane/site/git/refs/heads/jane_wip');
    expect(patch.body).toEqual({ sha: 'NEWMAIN', force: true });
  });
});

// --- fixtures -------------------------------------------------------------------

// A blob-only tree (total_count matches, so the pagination loop runs once and stops).
function treePage(): { tree: unknown[]; total_count: number } {
  return {
    total_count: 3,
    tree: [
      { path: 'content/pages/home/index.md', type: 'blob', sha: 'BLOB_INDEX', size: 4 },
      { path: 'content/pages/home/hero.webp', type: 'blob', sha: 'BLOB_HERO', size: 10 },
      { path: 'config/schemas/pages.yml', type: 'blob', sha: 'BLOB_SCHEMA', size: 6 },
    ],
  };
}

// A small repo on `main` with an index.md (BLOB_INDEX→"BODY"), a hero image (not snapshot),
// and a schema yaml (BLOB_SCHEMA). Reused by several tests.
function singleTreeRepo(): Routes {
  return {
    'GET /repos/jane/site': () => ({ json: { default_branch: 'main' } }),
    'GET /repos/jane/site/branches/main': () => ({ json: { commit: { id: 'C1' } } }),
    'GET /repos/jane/site/git/commits/C1': () => ({
      json: { commit: { tree: { sha: 'T1' } } },
    }),
    'GET /repos/jane/site/git/trees/T1': () => ({
      json: {
        total_count: 3,
        tree: [
          {
            path: 'content/pages/home/index.md',
            type: 'blob',
            sha: 'BLOB_INDEX',
            size: 4,
          },
          {
            path: 'content/pages/home/hero.webp',
            type: 'blob',
            sha: 'BLOB_HERO',
            size: 10,
          },
          { path: 'config/schemas/pages.yml', type: 'blob', sha: 'BLOB_SCHEMA', size: 6 },
        ],
      },
    }),
    'GET /repos/jane/site/git/blobs/BLOB_INDEX': () => ({
      json: { content: utf8ToBase64('BODY') },
    }),
    'GET /repos/jane/site/git/blobs/BLOB_SCHEMA': () => ({
      json: { content: utf8ToBase64('SCHEMA') },
    }),
    'POST /repos/jane/site/contents': () => ({ json: { commit: { sha: 'COMMITTED' } } }),
  };
}
