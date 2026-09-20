import type { BrowserContext, Page } from 'playwright';
import type { FakeGitHub } from './router.js';

/**
 * Route a browser's `api.github.com` traffic through the fake. The editor bundle runs
 * unmodified — `RepoClient`/Octokit still address the real origin — and Playwright's
 * network interception answers every request from the in-memory repo instead. Because
 * the answer never leaves the browser's own network stack, CORS still applies: the fake
 * sends the permissive headers and answers the `OPTIONS` preflight Octokit's
 * `authorization` header provokes.
 *
 * Install on a `BrowserContext` to cover every tab (the two-tabs-one-branch scenarios),
 * or on a single `Page`.
 */
export async function routeFakeGitHub(
  target: Page | BrowserContext,
  fake: FakeGitHub,
): Promise<void> {
  await target.route(`${fake.apiOrigin}/**`, async (route) => {
    const req = route.request();
    const postData = req.postDataBuffer();
    const response = await fake.handle(
      new Request(req.url(), {
        method: req.method(),
        headers: req.headers(),
        ...(postData ? { body: new Uint8Array(postData) } : {}),
      }),
    );
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    await route.fulfill({
      status: response.status,
      headers,
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}
