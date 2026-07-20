import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { CommitFilesInput, CommitResult } from '@timber/host';
import {
  unzipTheme,
  importThemeFromZip,
  type ImportSession,
} from '../src/theme/importTheme.js';

/** Build a zip wrapping the files in a single top-level dir, as a "Download ZIP" archive does. */
function makeZip(files: Record<string, string>, root = 'my-theme-1.0'): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files))
    entries[`${root}/${path}`] = strToU8(content);
  return zipSync(entries);
}

const THEME = {
  '_layouts/base.html': '<main>{{ content }}</main>',
  '_layouts/post.html': '---\nlayout: base\n---\n<article>{{ content }}</article>',
  '_layouts/page.html': '---\nlayout: base\n---\n<div>{{ content }}</div>',
  '_includes/head.html': '<meta>',
  'assets/css/style.scss': '---\n---\na{color:red}',
  '_sass/_vars.scss': '$c: red;',
};

describe('browser theme import', () => {
  it('unzips, stripping the archive’s wrapping directory', () => {
    const theme = unzipTheme(makeZip(THEME));
    expect(theme.text['_layouts/base.html']).toContain('{{ content }}');
    expect(theme.text['assets/css/style.scss']).toContain('a{color:red}');
    expect(theme.text['_sass/_vars.scss']).toBe('$c: red;');
  });

  it('imports into themes/<name>/ and commits the plan in one commit', async () => {
    let committed: CommitFilesInput | undefined;
    const session: ImportSession = {
      client: {
        commitFiles: async (input: CommitFilesInput): Promise<CommitResult> => {
          committed = input;
          return { sha: 'abc' };
        },
      },
      wipBranch: 'alice_wip',
      defaultBranch: 'main',
    };

    const plan = await importThemeFromZip(session, makeZip(THEME), {
      themeName: 'acme',
      typeMap: { posts: 'post' },
    });
    expect(plan.rootLayout).toBe('base');
    expect(plan.themeName).toBe('acme');
    expect(plan.mapped).toEqual({ posts: 'post' });

    expect(committed?.branch).toBe('alice_wip');
    expect(committed?.baseBranch).toBe('main');
    const paths = committed!.files.map((f) => f.path);
    expect(paths).toContain('themes/acme/templates/base.liquid');
    expect(paths).toContain('themes/acme/templates/default.liquid'); // fallback ensured
    expect(paths).toContain('themes/acme/templates/posts.liquid'); // from typeMap
    expect(paths).toContain('themes/acme/assets/css/style.scss'); // SCSS source (compiled later)
    expect(paths).toContain('themes/acme/assets/_sass/_vars.scss'); // _sass → assets/_sass
  });

  it('defaults the theme name from the archive’s wrapper directory (slugified)', async () => {
    let committed: CommitFilesInput | undefined;
    const session: ImportSession = {
      client: {
        commitFiles: async (input: CommitFilesInput): Promise<CommitResult> => {
          committed = input;
          return { sha: 'abc' };
        },
      },
      wipBranch: 'alice_wip',
      defaultBranch: 'main',
    };
    const plan = await importThemeFromZip(session, makeZip(THEME, 'Minima-3.0'));
    expect(plan.themeName).toBe('minima-3-0');
    expect(committed!.files.map((f) => f.path)).toContain(
      'themes/minima-3-0/templates/base.liquid',
    );
  });

  it('activates the theme by flipping settings.activeTheme in the same commit', async () => {
    let committed: CommitFilesInput | undefined;
    const session: ImportSession = {
      client: {
        commitFiles: async (input: CommitFilesInput): Promise<CommitResult> => {
          committed = input;
          return { sha: 'abc' };
        },
      },
      wipBranch: 'alice_wip',
      defaultBranch: 'main',
    };
    await importThemeFromZip(session, makeZip(THEME), {
      themeName: 'acme',
      activate: {
        path: 'content/settings/index.md',
        source: '---\ntitle: My Site\n---\n',
      },
    });
    const settings = committed!.files.find((f) => f.path === 'content/settings/index.md');
    expect(settings).toBeDefined();
    expect('content' in settings! ? settings.content : '').toContain('activeTheme: acme');
    expect('content' in settings! ? settings.content : '').toContain('title: My Site');
  });
});
