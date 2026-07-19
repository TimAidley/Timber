import { describe, it, expect } from 'vitest';
import type { HostProvider } from '@timber/host';
import { loadSiteTheme } from '../src/preview/siteTheme.js';

/**
 * Proves the preview's SCSS compilation runs in a REAL browser (Chromium) — dart-sass +
 * the in-memory importer, isomorphic with the Node build (SPEC §6). jsdom can't vouch for
 * the browser bundle actually loading `sass`, so this closes that gap.
 */
function fakeClient(files: Record<string, string>): HostProvider {
  const entries = Object.keys(files).map((path, i) => ({
    path,
    type: 'blob' as const,
    sha: `sha${i}`,
  }));
  const bySha = new Map(entries.map((e) => [e.sha, files[e.path]!]));
  return {
    loadTree: async () => ({ ref: 'main', commitSha: 'c', treeSha: 't', entries }),
    readBlob: async (sha: string) => bySha.get(sha) ?? '',
    readBinaryBlob: async () => new Uint8Array(),
  } as unknown as HostProvider;
}

describe('loadSiteTheme SCSS compilation (browser)', () => {
  it('compiles SCSS with an @import in real Chromium', async () => {
    const theme = await loadSiteTheme(
      fakeClient({
        'assets/css/style.scss': '---\n---\n@import "vars"; a { color: $c; }',
        'assets/_sass/_vars.scss': '$c: teal;',
      }),
      'main',
    );
    expect(theme.stylesheets.get('assets/css/style.css')).toBe('a{color:teal}');
  });
});
