#!/usr/bin/env tsx
/**
 * Record real GitHub API request/response pairs into `test/fixtures/github/*.json`,
 * one file per scenario, by driving `RepoClient` against the real sandbox repo
 * (TIMBER_SANDBOX_REPO, default TimAidley/Timber-test-sandbox). Run manually
 * whenever the recorded shape needs refreshing — never invoked by CI or `pnpm test`.
 *
 * Usage: TIMBER_SANDBOX_TOKEN=<PAT> pnpm --filter @timber/github record-fixtures
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Octokit } from '@octokit/rest';
import { RepoClient, fromEnv } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'test', 'fixtures', 'github');

const TOKEN_VAR = 'TIMBER_SANDBOX_TOKEN';
const owner = process.env.TIMBER_SANDBOX_OWNER ?? 'TimAidley';
const repo = process.env.TIMBER_SANDBOX_REPO ?? 'Timber-test-sandbox';

const DEFAULT_BRANCH = 'main';
const EXISTING_BRANCH = 'phase2-existing';
const NEW_BRANCH = 'phase2-new-branch-fixture';

interface Exchange {
  method: string;
  url: string;
  requestBody?: unknown;
  status: number;
  responseBody: unknown;
}

function wrapFetch(realFetch: typeof fetch, sink: Exchange[]): typeof fetch {
  return async (input, init) => {
    const method = init?.method ?? 'GET';
    const url = typeof input === 'string' ? input : input.toString();

    let requestBody: unknown;
    if (typeof init?.body === 'string') {
      try {
        requestBody = JSON.parse(init.body);
      } catch {
        requestBody = init.body;
      }
    }

    const response = await realFetch(input, init);
    const text = await response.clone().text();
    let responseBody: unknown;
    try {
      responseBody = text ? JSON.parse(text) : undefined;
    } catch {
      responseBody = text;
    }

    sink.push({
      method,
      url,
      ...(requestBody !== undefined ? { requestBody } : {}),
      status: response.status,
      responseBody,
    });
    return response;
  };
}

const realFetch = globalThis.fetch;

async function recordScenario(name: string, run: () => Promise<void>): Promise<void> {
  const sink: Exchange[] = [];
  globalThis.fetch = wrapFetch(realFetch, sink);
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(join(fixturesDir, `${name}.json`), `${JSON.stringify(sink, null, 2)}\n`);
  console.log(`recorded ${sink.length} exchange(s) -> ${name}.json`);
}

async function main(): Promise<void> {
  if (!process.env[TOKEN_VAR]) {
    console.error(`record-fixtures: set ${TOKEN_VAR} to a PAT scoped to ${owner}/${repo}`);
    process.exit(1);
  }

  const getToken = fromEnv(TOKEN_VAR);
  const client = new RepoClient({ owner, repo, getToken });
  // Raw Octokit only for one-off setup/teardown (deleting a branch) that
  // RepoClient itself has no need to expose as public API.
  const setupOctokit = new Octokit({ auth: process.env[TOKEN_VAR] });

  await recordScenario('get-default-branch', async () => {
    await client.getDefaultBranch();
  });

  await recordScenario('load-tree', async () => {
    await client.loadTree(DEFAULT_BRANCH);
  });

  await recordScenario('read-file', async () => {
    await client.readFile('content/pages/hello/index.md', DEFAULT_BRANCH);
  });

  // Ensure EXISTING_BRANCH is actually present before recording that scenario.
  // commitFiles() already auto-creates the branch from baseBranch when it's
  // missing, so this unconditionally "seeds" it whether or not it exists yet.
  await client.commitFiles({
    branch: EXISTING_BRANCH,
    baseBranch: DEFAULT_BRANCH,
    message: 'chore: seed phase2-existing branch for fixture recording',
    files: [{ path: 'content/pages/hello/index.md', content: 'seed\n' }],
  });

  await recordScenario('commit-files-existing-branch', async () => {
    await client.commitFiles({
      branch: EXISTING_BRANCH,
      message: 'test(github): recorded fixture commit (existing branch)',
      files: [
        { path: 'content/pages/hello/index.md', content: 'Recorded fixture content A.\n' },
        { path: 'content/pages/new/index.md', content: 'Recorded fixture content B.\n' },
      ],
    });
  });

  // Ensure NEW_BRANCH does NOT exist before recording the "create it" scenario.
  // (GitHub's delete-ref endpoint 422s — not 404s — for an already-absent ref, so
  // check existence first via the same getBranchSha() the client itself uses.)
  if (await client.getBranchSha(NEW_BRANCH)) {
    await setupOctokit.rest.git.deleteRef({ owner, repo, ref: `heads/${NEW_BRANCH}` });
  }

  await recordScenario('commit-files-new-branch', async () => {
    await client.commitFiles({
      branch: NEW_BRANCH,
      baseBranch: DEFAULT_BRANCH,
      message: 'test(github): recorded fixture commit (new branch)',
      files: [{ path: 'content/pages/hello/index.md', content: 'Recorded fixture content C.\n' }],
    });
  });

  console.log('done.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
