import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { CommitFilesInput, CommitResult } from '@timber/host';
import { importThemeFromZip, type ImportSession } from '../src/theme/importTheme.js';

/**
 * Proves the browser theme-import path runs in real Chromium: fflate unzip + the isomorphic
 * planner in the actual browser bundle, committing through the host client. (jsdom-in-Node
 * can't vouch for the browser bundle.)
 */
describe('browser theme import (Chromium)', () => {
  it('unzips + plans + commits a theme', async () => {
    const zip = zipSync({
      'theme-1/_layouts/base.html': strToU8('<main>{{ content }}</main>'),
      'theme-1/_layouts/page.html': strToU8(
        '---\nlayout: base\n---\n<div>{{ content }}</div>',
      ),
      'theme-1/assets/css/style.scss': strToU8('---\n---\na{color:red}'),
      'theme-1/_sass/_vars.scss': strToU8('$c: red;'),
    });

    let committed: CommitFilesInput | undefined;
    const session: ImportSession = {
      client: {
        commitFiles: async (input: CommitFilesInput): Promise<CommitResult> => {
          committed = input;
          return { sha: 'x' };
        },
      },
      wipBranch: 'me_wip',
      defaultBranch: 'main',
    };

    const plan = await importThemeFromZip(session, zip, { themeName: 'theme-1' });
    expect(plan.rootLayout).toBe('base');
    expect(plan.themeName).toBe('theme-1');
    const paths = committed!.files.map((f) => f.path);
    expect(paths).toContain('themes/theme-1/templates/base.liquid');
    expect(paths).toContain('themes/theme-1/assets/_sass/_vars.scss');
  });
});
