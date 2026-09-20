import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeGitHub, type FakeRepo } from '@timber/fake-github';
import { seedRepoFromDir } from '@timber/fake-github/node';
import { routeFakeGitHub } from '@timber/fake-github/playwright';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(here, '..', '..', '..');
export const SITE_TEMPLATE = join(APP_ROOT, '..', '..', 'site-template');

export const OWNER = 'acme';
export const REPO = 'village-hall';
export const LOGIN = 'alice';
export const TOKEN = 'ghp_fake_token';
export const WIP_BRANCH = `${LOGIN}_wip`;

/**
 * The editor served by Vite plus a headless browser — started once per test file, shared
 * across its tests. The fake GitHub is per-test (see {@link openEditor}) so tests never
 * share repo state.
 */
export interface EditorServer {
  url: string;
  browser: Browser;
  close(): Promise<void>;
}

export interface StartEditorServerOptions {
  /**
   * A runtime config to serve as `/config.js` (`window.__TIMBER_CONFIG__`) in place of
   * the checkout's own — how the editor is pointed at a fake repo. Default: the one the
   * e2e tests use (owner/repo above, requests routed through Playwright).
   */
  config?: Record<string, unknown>;
  /** Default: a free port. */
  port?: number;
  /** Default: launch a headless browser. `false` when someone else brings the browser. */
  browser?: boolean;
}

export async function startEditorServer(
  options: StartEditorServerOptions = {},
): Promise<EditorServer> {
  const config = options.config ?? { owner: OWNER, repo: REPO };
  const server: ViteDevServer = await createServer({
    configFile: join(APP_ROOT, 'vite.config.ts'),
    root: APP_ROOT,
    // Bind the loopback ADDRESS, not the name: on Windows `localhost` resolves to ::1, so a
    // Vite bound to it refuses `http://127.0.0.1:…` — the form every doc here uses.
    server: {
      host: '127.0.0.1',
      port: options.port ?? 0,
      strictPort: options.port !== undefined,
    },
    logLevel: 'warn',
    plugins: [
      {
        // Serve the harness's config ahead of Vite's static `public/config.js`.
        name: 'timber-e2e-config',
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url?.split('?')[0] !== '/config.js') return next();
            res.setHeader('content-type', 'application/javascript');
            res.end(`window.__TIMBER_CONFIG__ = ${JSON.stringify(config)};`);
          });
        },
      },
    ],
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('Vite did not report a local URL');
  const browser = options.browser === false ? undefined : await chromium.launch();
  return {
    url,
    get browser() {
      if (!browser) throw new Error('startEditorServer was called with browser: false');
      return browser;
    },
    async close() {
      await browser?.close();
      await server.close();
    },
  };
}

export interface EditorSession {
  fake: FakeGitHub;
  repo: FakeRepo;
  context: BrowserContext;
  page: Page;
  /** Console errors + uncaught page errors seen so far — a test can assert there were none. */
  browserErrors: string[];
  close(): Promise<void>;
}

export interface OpenEditorOptions {
  /** Deploy-run pacing for the fake Actions. Default: completes on the next poll. */
  actions?: { queuedMs: number; runMs: number };
  /** Skip the sign-in gate (a session that starts already connected). Default: sign in via the UI. */
  signIn?: boolean;
}

/**
 * A fresh fake repo seeded from `site-template/`, a fresh browser context whose
 * `api.github.com` traffic is routed to it, and a page that has pasted the fake PAT and
 * reached the loaded editor. (The server's `/config.js` already names the fake repo.)
 */
export async function openEditor(
  server: EditorServer,
  options: OpenEditorOptions = {},
): Promise<EditorSession> {
  const fake = new FakeGitHub();
  fake.addUser(LOGIN, TOKEN);
  const repo = fake.addRepo({
    owner: OWNER,
    repo: REPO,
    ...(options.actions ? { actions: options.actions } : {}),
  });
  await seedRepoFromDir(repo, SITE_TEMPLATE, {
    message: 'Seed site from Timber site-template',
  });

  const context = await server.browser.newContext();
  await routeFakeGitHub(context, fake);

  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on('pageerror', (err) => browserErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    // The fake answers a missing WIP branch with a 404 by design; the browser logs every
    // non-2xx fetch as an error, which isn't the app's doing.
    if (msg.type() === 'error' && !/404|Failed to load resource/.test(msg.text())) {
      browserErrors.push(`console: ${msg.text()}`);
    }
  });

  await page.goto(server.url);
  if (options.signIn !== false) {
    await page.getByLabel('GitHub personal access token').fill(TOKEN);
    await page.getByRole('button', { name: 'Connect' }).click();
    await page
      .getByRole('banner')
      .getByRole('button', { name: /^Publish/ })
      .waitFor();
  }

  return {
    fake,
    repo,
    context,
    page,
    browserErrors,
    close: () => context.close(),
  };
}

/** Poll until `predicate` holds (autosave is debounced; a commit takes a moment to land). */
export async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 20_000,
  label = 'condition',
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
