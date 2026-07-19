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

  it('imports and commits the plan to the WIP branch in one commit', async () => {
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
      typeMap: { posts: 'post' },
    });
    expect(plan.rootLayout).toBe('base');
    expect(plan.mapped).toEqual({ posts: 'post' });

    expect(committed?.branch).toBe('alice_wip');
    expect(committed?.baseBranch).toBe('main');
    const paths = committed!.files.map((f) => f.path);
    expect(paths).toContain('templates/base.liquid');
    expect(paths).toContain('templates/default.liquid'); // fallback ensured
    expect(paths).toContain('templates/posts.liquid'); // from typeMap
    expect(paths).toContain('assets/css/style.scss'); // SCSS source committed (compiled later)
    expect(paths).toContain('assets/_sass/_vars.scss'); // _sass → assets/_sass
  });
});
