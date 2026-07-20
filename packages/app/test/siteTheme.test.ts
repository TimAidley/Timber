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

describe('loadSiteTheme active theme (SPEC §13)', () => {
  it('resolves templates + assets from themes/<name>/ and keys stylesheets by output path', async () => {
    const theme = await loadSiteTheme(
      fakeClient({
        'themes/acme/templates/default.liquid': '<html></html>',
        'themes/acme/assets/theme.scss': '---\n---\n@import "vars"; body { color: $c; }',
        'themes/acme/assets/_sass/_vars.scss': '$c: teal;',
        'assets/logo.css': '.logo{color:red}', // a site-level file, published as-is
        'templates/default.liquid': '<other></other>', // legacy root — NOT the active theme
      }),
      'main',
      'acme',
    );
    // The active theme's template wins over any legacy-root template.
    expect(theme.templates.get('default.liquid')).toBe('<html></html>');
    // The theme's SCSS is published at its OUTPUT path — the URL the <link>/build reference.
    expect(theme.stylesheets.get('assets/theme.css')).toBe('body{color:teal}');
    // A site-level upload still publishes alongside the theme.
    expect(theme.stylesheets.get('assets/logo.css')).toContain('.logo');
  });

  it('lets a site-level upload override a theme asset on a path clash', async () => {
    const theme = await loadSiteTheme(
      fakeClient({
        'themes/acme/templates/default.liquid': '<html></html>',
        'themes/acme/assets/shared.css': '.from-theme{color:red}',
        'assets/shared.css': '.from-site{color:blue}',
      }),
      'main',
      'acme',
    );
    expect(theme.stylesheets.get('assets/shared.css')).toContain('.from-site');
    expect(theme.stylesheets.get('assets/shared.css')).not.toContain('.from-theme');
  });

  it('falls back to the legacy root when activeTheme names a missing folder', async () => {
    const theme = await loadSiteTheme(
      fakeClient({ 'templates/default.liquid': '<html></html>' }),
      'main',
      'ghost',
    );
    expect(theme.templates.get('default.liquid')).toBe('<html></html>');
  });
});
