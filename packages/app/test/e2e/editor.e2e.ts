import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  openEditor,
  startEditorServer,
  waitUntil,
  WIP_BRANCH,
  type EditorServer,
  type EditorSession,
} from './support/harness.js';

// The smoke test that proves the fake is a stand-in for GitHub at the level that
// matters: the unmodified editor bundle, in a real browser, walks its whole
// load → edit → autosave → publish → deploy-status loop against it. Everything else
// built on the fake (component tests, virtual-user runs) rests on this passing.
//
// Assertions on the page use Playwright's own auto-waiting (`waitFor`, `isEnabled`…)
// and vitest's `expect` on the values — `@playwright/test`'s locator matchers aren't
// available inside vitest.
describe('editor against FakeGitHub in headless Chromium', () => {
  let server: EditorServer;
  let session: EditorSession | undefined;

  beforeAll(async () => {
    server = await startEditorServer();
  });
  afterAll(async () => {
    await server.close();
  });
  afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  it('signs in with a PAT and loads the seeded site-template', async () => {
    session = await openEditor(server);
    const { page, fake } = session;

    const nav = page.getByRole('navigation');
    await nav.getByRole('button', { name: /^About/ }).waitFor();
    await nav.getByRole('button', { name: /^Welcome/ }).waitFor();
    expect(await page.getByRole('heading', { level: 2 }).textContent()).toBe('About');
    expect(await page.getByRole('textbox', { name: 'title *' }).inputValue()).toBe(
      'About',
    );
    expect(await page.getByRole('button', { name: 'Publish' }).isDisabled()).toBe(true);

    // The fake modelled everything the editor asked for.
    expect(fake.unhandled).toEqual([]);
    expect(session.browserErrors).toEqual([]);
  });

  it('autosaves an edit to the WIP branch, publishes it to main, and reports the deploy', async () => {
    session = await openEditor(server, { actions: { queuedMs: 300, runMs: 1500 } });
    const { page, repo, fake } = session;
    const mainBefore = repo.getRef('main')!;

    // Edit → the debounced autosave commits to <login>_wip. The client creates the branch
    // at main's tip first and commits onto it after, so wait for the tip to move, not
    // merely for the branch to exist.
    await page.getByRole('textbox', { name: 'title *' }).fill('About the hall');
    await waitUntil(
      () =>
        repo.getRef(WIP_BRANCH) !== undefined && repo.getRef(WIP_BRANCH) !== mainBefore,
      20_000,
      'the autosave commit',
    );
    expect(repo.readFile('content/pages/about/index.md', WIP_BRANCH)).toContain(
      'title: About the hall',
    );
    expect(repo.readFile('content/pages/about/index.md', 'main')).toContain(
      'title: About\n',
    );
    expect(repo.log(WIP_BRANCH).at(-1)!.sha).toBe(repo.log('main').at(-1)!.sha);

    // Publish → the dialog lists the change; confirming squash-merges WIP onto main.
    // (`click` auto-waits for the button to be enabled, which follows the autosave's refresh.)
    await page.getByRole('button', { name: 'Publish' }).click();
    const dialog = page.getByRole('dialog', { name: 'Publish' });
    await dialog
      .getByRole('button', { name: /^modified content\/pages\/about\/index\.md/ })
      .waitFor();
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

    await waitUntil(
      () => repo.getRef('main') !== mainBefore,
      20_000,
      'the publish commit',
    );
    const [published, parent] = repo.log('main');
    expect(parent!.sha).toBe(mainBefore);
    expect(published!.parents).toEqual([mainBefore]); // one squash commit, not WIP's history
    expect(repo.readFile('content/pages/about/index.md', 'main')).toContain(
      'title: About the hall',
    );
    expect(repo.getRef(WIP_BRANCH)).toBe(published!.sha); // WIP reset onto the new main

    // The push to main started a deploy run; the header follows it to "Published ✓".
    expect(
      repo.actions.list().some((r) => r.event === 'push' && r.headSha === published!.sha),
    ).toBe(true);
    await page.getByRole('button', { name: 'Published ✓' }).waitFor({ timeout: 20_000 });

    expect(fake.unhandled).toEqual([]);
    expect(session.browserErrors).toEqual([]);
  });
});
