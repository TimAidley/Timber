import { describe, it, expect } from 'vitest';
import { listThemes, themeFolderPaths } from '../src/theme/themeFolders.js';
import type { TreeEntry } from '@timber/host';

const entries: TreeEntry[] = [
  { path: 'themes/default/templates/default.liquid', type: 'blob', sha: '1' },
  { path: 'themes/default/assets/theme.css', type: 'blob', sha: '2' },
  { path: 'themes/minima/templates/base.liquid', type: 'blob', sha: '3' },
  { path: 'themes/minima/assets/css/style.scss', type: 'blob', sha: '4' },
  // A folder with assets but no templates — not a renderable theme.
  { path: 'themes/orphan/assets/x.css', type: 'blob', sha: '5' },
  { path: 'content/pages/home/index.md', type: 'blob', sha: '6' },
  { path: 'templates/legacy.liquid', type: 'blob', sha: '7' },
] as TreeEntry[];

describe('listThemes', () => {
  it('lists distinct theme names that have templates, sorted', () => {
    expect(listThemes(entries)).toEqual(['default', 'minima']);
  });

  it('is empty for a legacy (no themes/) tree', () => {
    expect(
      listThemes([
        { path: 'templates/default.liquid', type: 'blob', sha: '1' },
      ] as TreeEntry[]),
    ).toEqual([]);
  });
});

describe('themeFolderPaths', () => {
  it('returns every path under themes/<name>/ (the delete set)', () => {
    expect(themeFolderPaths(entries, 'minima')).toEqual([
      'themes/minima/templates/base.liquid',
      'themes/minima/assets/css/style.scss',
    ]);
  });

  it('does not match a different theme or a name-prefix collision', () => {
    expect(themeFolderPaths(entries, 'default')).toEqual([
      'themes/default/templates/default.liquid',
      'themes/default/assets/theme.css',
    ]);
    expect(themeFolderPaths(entries, 'min')).toEqual([]); // not a prefix match
  });
});
