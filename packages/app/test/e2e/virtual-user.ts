import type { IncomingMessage, ServerResponse } from 'node:http';
import { FakeGitHub } from '@timber/fake-github';
import { seedRepoFromDir, serveFakeGitHub } from '@timber/fake-github/node';
import {
  LOGIN,
  OWNER,
  REPO,
  SITE_TEMPLATE,
  startEditorServer,
  TOKEN,
} from './support/harness.js';

/**
 * The virtual-user launcher: the real editor on a fixed local port, backed by a fake
 * GitHub served over plain HTTP, for a browser this process does NOT control — Playwright
 * MCP's, or a human's. Unlike the e2e tests there is no request interception: the editor
 * is pointed at the fake through its `apiBaseUrl` config, exactly as a GitHub Enterprise
 * site would be.
 *
 *   pnpm virtual-user            # then open http://127.0.0.1:5199/ and paste the token
 *
 * The fake also exposes a small **control API** (GET, so a browser tab or `curl` can hit
 * it) — the "world outside the browser" a scenario needs: another device pushing to the
 * branch, the host failing a request, a deploy that fails. And `/__control/state` is the
 * ground truth an orchestrator checks a tester's claims against.
 */
const EDITOR_PORT = Number(process.env.TIMBER_VU_EDITOR_PORT ?? 5199);
const API_PORT = Number(process.env.TIMBER_VU_API_PORT ?? 5198);

const fake = new FakeGitHub();
fake.addUser(LOGIN, TOKEN);
// Deploys take long enough to watch: ~2s queued, ~8s building.
const repo = fake.addRepo({
  owner: OWNER,
  repo: REPO,
  actions: { queuedMs: 2000, runMs: 8000 },
});
await seedRepoFromDir(repo, SITE_TEMPLATE, {
  message: 'Seed site from Timber site-template',
});

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body, null, 2));
}

async function control(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://control.invalid');
  if (!url.pathname.startsWith('/__control')) return false;
  const q = (name: string) => url.searchParams.get(name);
  const action = url.pathname.slice('/__control'.length).replace(/^\/+|\/+$/g, '');

  switch (action) {
    case '':
      json(res, 200, {
        endpoints: {
          '/__control/state':
            'branches, files and log per branch, deploy runs, unhandled requests',
          '/__control/requests?tail=50': 'the most recent requests the fake served',
          '/__control/push?branch=&path=&content=&message=':
            'commit a file to a branch as SOMEONE ELSE (a foreign push)',
          '/__control/delete?branch=&path=':
            'delete a file from a branch as someone else',
          '/__control/fail-next?method=GET&path=<regexp>&status=500&times=1':
            'fail the next matching request(s)',
          '/__control/revoke-token':
            'make the pasted token invalid from now on (every request 401s)',
          '/__control/restore-token': 'make the token valid again',
          '/__control/deploy-fail-next': 'the next deploy run concludes with failure',
          '/__control/shutdown':
            'stop this environment (a new launcher calls it for you)',
        },
      });
      return true;
    case 'state': {
      const branches = repo.listBranches().map((b) => ({
        ...b,
        files: repo.listFiles(b.name),
        log: repo.log(b.name).map((c) => ({
          sha: c.sha.slice(0, 7),
          message: c.message,
          author: c.author.name,
        })),
      }));
      json(res, 200, {
        defaultBranch: repo.defaultBranch,
        branches,
        deployRuns: repo.actions.list().map((r) => repo.actions.toApi(r)),
        unhandled: fake.unhandled,
        servedCount: fake.served.length,
      });
      return true;
    }
    case 'requests':
      json(res, 200, fake.served.slice(-Number(q('tail') ?? 50)));
      return true;
    case 'push': {
      const branch = q('branch');
      const path = q('path');
      if (!branch || !path)
        return (json(res, 400, { message: 'branch and path are required' }), true);
      const commit = await repo.writeFiles(
        branch,
        { [path]: q('content') ?? '' },
        q('message') ?? `Edit ${path} from another device`,
      );
      json(res, 200, { sha: commit.sha, branch, path });
      return true;
    }
    case 'delete': {
      const branch = q('branch');
      const path = q('path');
      if (!branch || !path)
        return (json(res, 400, { message: 'branch and path are required' }), true);
      const commit = await repo.writeFiles(
        branch,
        { [path]: null },
        q('message') ?? `Delete ${path} from another device`,
      );
      json(res, 200, { sha: commit.sha, branch, path });
      return true;
    }
    case 'fail-next': {
      const fault = fake.failNext(
        (q('method') ?? 'GET').toUpperCase(),
        new RegExp(q('path') ?? '.'),
        Number(q('status') ?? 500),
        q('message') ?? undefined,
        Number(q('times') ?? 1),
      );
      json(res, 200, { armed: { status: fault.status, times: fault.times } });
      return true;
    }
    case 'revoke-token':
      fake.tokens.delete(TOKEN);
      json(res, 200, { token: 'revoked' });
      return true;
    case 'restore-token':
      fake.addUser(LOGIN, TOKEN);
      json(res, 200, { token: 'valid' });
      return true;
    case 'deploy-fail-next':
      repo.actions.failNextRun();
      json(res, 200, { nextDeploy: 'failure' });
      return true;
    case 'shutdown':
      json(res, 200, { stopping: true });
      setTimeout(() => void shutdown(), 50);
      return true;
    default:
      json(res, 404, {
        message: `unknown control action "${action}"; GET /__control lists them`,
      });
      return true;
  }
}

async function orExplainPortInUse<T>(port: number, start: () => Promise<T>): Promise<T> {
  try {
    return await start();
  } catch (err) {
    if (err instanceof Error && /EADDRINUSE|already in use/i.test(err.message)) {
      console.error(
        `\nPort ${port} is already in use — most likely a previous \`pnpm virtual-user\` is still ` +
          `running (its repo state is stale). Stop it (kill the node process listening on ${port}) ` +
          `and start again for a fresh seed.\n`,
      );
      process.exit(1);
    }
    throw err;
  }
}

/**
 * Killing the `pnpm` wrapper that started a previous launcher (e.g. stopping a background
 * task) can leave its node child alive with both ports bound and a stale repo. Rather than
 * make the user hunt for it, ask it to stop over its own control API and wait for the port.
 */
async function stopPreviousInstance(): Promise<void> {
  const controlUrl = `http://127.0.0.1:${API_PORT}/__control/shutdown`;
  try {
    const res = await fetch(controlUrl, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return;
  } catch {
    return; // nothing listening — the normal case
  }
  console.log('Stopped a previous virtual-user environment that was still running.');
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      await fetch(`http://127.0.0.1:${API_PORT}/__control`, {
        signal: AbortSignal.timeout(300),
      });
    } catch {
      return; // port released
    }
  }
}

await stopPreviousInstance();
const api = await orExplainPortInUse(API_PORT, () =>
  serveFakeGitHub(fake, { port: API_PORT, onRequest: control }),
);
const editor = await orExplainPortInUse(EDITOR_PORT, () =>
  startEditorServer({
    port: EDITOR_PORT,
    browser: false,
    config: { owner: OWNER, repo: REPO, apiBaseUrl: api.url },
  }),
);

console.log(`
Timber virtual-user environment
  Editor:      ${editor.url}
  Fake GitHub: ${api.url}   (repo ${OWNER}/${REPO}, seeded from site-template/)
  Sign in:     paste the token  ${TOKEN}
  Control API: ${api.url}/__control
Press Ctrl-C to stop.
`);

async function shutdown(): Promise<void> {
  await editor.close();
  await api.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
