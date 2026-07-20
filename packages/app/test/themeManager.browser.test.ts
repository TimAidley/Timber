import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CommitFilesInput, CommitResult, TreeEntry } from '@timber/host';
import { ThemeManager } from '../src/advanced/ThemeManager.js';
import type { RepoSession } from '../src/state/repoSession.js';
import '../src/styles.css';

/**
 * Drives the theme manager in a live DOM: it lists the themes/<name>/ folders, and the
 * switch/delete buttons commit the right payloads (settings.activeTheme flip, folder deletion)
 * to the working branch (SPEC §13).
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

const TREE: TreeEntry[] = [
  { path: 'themes/default/templates/default.liquid', type: 'blob', sha: '1' },
  { path: 'themes/default/assets/theme.css', type: 'blob', sha: '2' },
  { path: 'themes/minima/templates/base.liquid', type: 'blob', sha: '3' },
  { path: 'themes/minima/assets/css/style.scss', type: 'blob', sha: '4' },
] as TreeEntry[];

function mount(): { commits: CommitFilesInput[] } {
  const commits: CommitFilesInput[] = [];
  const session = {
    wipBranch: 'me_wip',
    defaultBranch: 'main',
    client: {
      commitFiles: async (input: CommitFilesInput): Promise<CommitResult> => {
        commits.push(input);
        return { sha: 'x' };
      },
    },
  } as unknown as RepoSession;

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(ThemeManager, {
      session,
      activeTheme: 'default',
      settingsFile: { path: 'content/settings/index.md', source: '---\ntitle: T\n---\n' },
      treeEntries: TREE,
    }),
  );
  return { commits };
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

async function waitFor<T>(fn: () => T | null | undefined, timeout = 4000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (performance.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

function rowFor(name: string): HTMLLIElement | null {
  const li = [...document.querySelectorAll('.theme-manager__list > li')].find((el) =>
    el.querySelector('code')?.textContent?.includes(`themes/${name}/`),
  );
  return (li as HTMLLIElement) ?? null;
}

describe('ThemeManager (rendered)', () => {
  it('lists theme folders and marks the active one (which can’t be deleted)', async () => {
    mount();
    const active = await waitFor(() => rowFor('default'));
    expect(active.textContent).toMatch(/Active/);
    // The active theme offers no switch/delete buttons — only "In use".
    expect(active.querySelector('button')).toBeNull();
    expect(rowFor('minima')?.querySelector('button')).not.toBeNull();
  });

  it('switches the active theme by committing settings.activeTheme', async () => {
    const { commits } = mount();
    const use = await waitFor(() =>
      rowFor('minima')?.querySelector<HTMLButtonElement>('button.is-primary'),
    );
    use.click();
    await waitFor(() => (commits.length ? true : null));
    const [c] = commits;
    expect(c!.branch).toBe('me_wip');
    const settings = c!.files.find((f) => f.path === 'content/settings/index.md');
    expect(settings && 'content' in settings ? settings.content : '').toMatch(
      /activeTheme: minima/,
    );
  });

  it('deletes a theme folder after confirmation, removing every path under it', async () => {
    const { commits } = mount();
    const del = await waitFor(() => {
      const row = rowFor('minima');
      return row
        ? [...row.querySelectorAll('button')].find((b) => b.textContent === 'Delete')
        : null;
    });
    del.click();
    const confirm = await waitFor(() =>
      document.querySelector<HTMLButtonElement>('.theme-manager__confirm button.is-danger'),
    );
    confirm.click();
    await waitFor(() => (commits.length ? true : null));
    expect(commits[0]!.deletions).toEqual([
      'themes/minima/templates/base.liquid',
      'themes/minima/assets/css/style.scss',
    ]);
  });
});
