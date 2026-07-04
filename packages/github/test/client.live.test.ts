import { Octokit } from '@octokit/rest';
import { afterAll, describe, expect, it } from 'vitest';
import { RepoClient, fromEnv } from '../src/index.js';

/**
 * Live suite: exercises RepoClient against the real GitHub API and a real
 * dedicated sandbox repo, not a cassette. Gated on TIMBER_SANDBOX_TOKEN so it's
 * inert (skipped) with no env vars set — `pnpm test` never runs this file; only
 * `pnpm test:live` does, on a nightly schedule or on demand (see
 * .github/workflows/live-github-tests.yml).
 */
const TOKEN_VAR = 'TIMBER_SANDBOX_TOKEN';
const owner = process.env.TIMBER_SANDBOX_OWNER ?? 'TimAidley';
const repo = process.env.TIMBER_SANDBOX_REPO ?? 'Timber-test-sandbox';
const rawToken = process.env[TOKEN_VAR];

// A fresh branch name per run so concurrent/repeated live runs never collide.
const scratchBranch = `test-scratch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!rawToken)('RepoClient (live, against the real sandbox repo)', () => {
  const client = new RepoClient({ owner, repo, getToken: fromEnv(TOKEN_VAR) });

  afterAll(async () => {
    if (!rawToken) return;
    // Best-effort cleanup so the sandbox repo doesn't accumulate scratch
    // branches — runs even if a test above failed.
    const octokit = new Octokit({ auth: rawToken });
    await octokit.rest.git
      .deleteRef({ owner, repo, ref: `heads/${scratchBranch}` })
      .catch(() => undefined);
  });

  it('loads the default branch tree from the real repo', async () => {
    const tree = await client.loadTree();
    expect(tree.entries.some((e) => e.path === 'content/pages/hello/index.md')).toBe(true);
    expect(tree.entries.some((e) => e.path === 'templates' && e.type === 'tree')).toBe(true);
  });

  it('reads a real file from the real repo', async () => {
    const content = await client.readFile('content/pages/hello/index.md');
    expect(content).toContain('placeholder page');
  });

  it('commits a file to a brand-new scratch branch and reads it back', async () => {
    const marker = `live test run ${scratchBranch}\n`;

    const result = await client.commitFiles({
      branch: scratchBranch,
      baseBranch: 'main',
      message: `test: live scratch commit (${scratchBranch})`,
      files: [{ path: 'content/pages/hello/index.md', content: marker }],
    });
    expect(result.sha).toBeTruthy();

    const committed = await client.readFile('content/pages/hello/index.md', scratchBranch);
    expect(committed).toBe(marker);
  });

  it('resolves the authenticated login (for the <login>_wip branch)', async () => {
    const login = await client.getAuthenticatedLogin();
    expect(typeof login).toBe('string');
    expect(login.length).toBeGreaterThan(0);
  });

  it('loadSnapshot() builds a path->utf8 map of the content/config text files', async () => {
    const snapshot = await client.loadSnapshot();
    expect(snapshot.get('content/pages/hello/index.md')).toContain('placeholder page');
    // Only text files under content/ and config/ are loaded.
    expect([...snapshot.keys()].every((p) => /^(content|config)\/.*\.(md|ya?ml)$/.test(p))).toBe(
      true,
    );
  });

  it('coalesces a text edit and a binary image into a single WIP commit', async () => {
    const marker = `wip coalesced ${scratchBranch}\n`;
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes

    const result = await client.commitFiles({
      branch: scratchBranch,
      message: `test: coalesced text+binary (${scratchBranch})`,
      files: [
        { path: 'content/pages/hello/index.md', content: marker },
        { path: 'content/pages/hello/images/pixel.png', bytes: png },
      ],
    });
    expect(result.sha).toBeTruthy();

    // Verify via the Git Data API (the exact committed tree/blobs), not the Contents
    // API — getContent is CDN-cached and can return stale content right after a commit.
    const tree = await client.loadTree(scratchBranch);
    const mdEntry = tree.entries.find((e) => e.path === 'content/pages/hello/index.md');
    const pngEntry = tree.entries.find((e) => e.path === 'content/pages/hello/images/pixel.png');
    expect(mdEntry).toBeDefined();
    expect(pngEntry).toBeDefined();
    expect(await client.readBlob(mdEntry!.sha)).toBe(marker);
  });
});
