import { describe, it, expect } from 'vitest';
import type { HostProvider } from '@timber/host';
import { loadSiteTheme } from '../src/preview/siteTheme.js';

/** A minimal fake host client exposing just what loadSiteTheme reads (tree + blobs). */
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

describe('loadSiteTheme SCSS compilation', () => {
  it('compiles a main .scss (front-matter fence) to its .css path, resolving @import from _sass', async () => {
    const theme = await loadSiteTheme(
      fakeClient({
        'templates/default.liquid': '<html></html>',
        'assets/css/style.scss': '---\n---\n@import "vars"; .site-header { color: $c; }',
        'assets/_sass/_vars.scss': '$c: teal;',
      }),
      'main',
    );
    expect(theme.stylesheets.get('assets/css/style.css')).toBe(
      '.site-header{color:teal}',
    );
  });

  it('does not emit a .css for a bare partial (no front-matter fence)', async () => {
    const theme = await loadSiteTheme(
      fakeClient({ 'assets/_sass/_only.scss': '$c: red;' }),
      'main',
    );
    expect(theme.stylesheets.size).toBe(0);
  });

  it('still loads a committed plain .css verbatim', async () => {
    const theme = await loadSiteTheme(
      fakeClient({ 'assets/theme.css': '.x{color:red}' }),
      'main',
    );
    expect(theme.stylesheets.get('assets/theme.css')).toContain('.x');
  });
});
