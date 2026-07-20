import { describe, it, expect } from 'vitest';
import { resolveThemePaths } from '@timber/content';
import { kindOf } from '../src/advanced/loadAdvancedFiles.js';
import { newFilePath, validateFileName } from '../src/advanced/newFile.js';
import { listSiteAssets } from '../src/media/siteAssets.js';
import { siteAssetPath } from '../src/media/assetName.js';
import { findAssetReferences } from '../src/media/assetReferences.js';
import type { TreeEntry } from '@timber/host';

// The advanced area, scoped to the active theme (SPEC §13): every path helper resolves against
// the theme's own folder, so editing/creating/uploading only ever touches the current theme.
const theme = resolveThemePaths('acme', () => true);

describe('advanced area scoped to the active theme', () => {
  it('kindOf classifies files under the active theme, ignoring a sibling theme', () => {
    expect(kindOf('themes/acme/templates/default.liquid', theme)).toBe('template');
    expect(kindOf('themes/acme/assets/theme.css', theme)).toBe('style');
    expect(kindOf('config/schemas/x.yml', theme)).toBe('schema');
    // A different theme's files are not "the theme" right now.
    expect(kindOf('themes/other/templates/default.liquid', theme)).toBeUndefined();
    // The legacy root isn't the active theme either.
    expect(kindOf('templates/default.liquid', theme)).toBeUndefined();
  });

  it('newFilePath + validateFileName target the active theme folder', () => {
    expect(newFilePath({ kind: 'template', name: 'events' }, theme)).toBe(
      'themes/acme/templates/events.liquid',
    );
    expect(newFilePath({ kind: 'style', name: 'print' }, theme)).toBe(
      'themes/acme/assets/print.css',
    );
    // config is site-level, not theme-scoped
    expect(newFilePath({ kind: 'config', name: 'navigation' }, theme)).toBe(
      'config/navigation.yml',
    );
    const existing = new Set(['themes/acme/templates/events.liquid']);
    expect(validateFileName('template', 'events', existing, theme)).toMatch(/already exists/);
    expect(validateFileName('template', 'people', existing, theme)).toBeNull();
  });

  it('listSiteAssets + siteAssetPath use the active theme’s asset dir', () => {
    const entries: TreeEntry[] = [
      { path: 'themes/acme/assets/logo.png', type: 'blob', sha: 'a' },
      { path: 'themes/acme/assets/fonts/x.woff2', type: 'blob', sha: 'b' },
      { path: 'themes/other/assets/skip.png', type: 'blob', sha: 'c' }, // sibling theme
      { path: 'assets/legacy.png', type: 'blob', sha: 'd' }, // legacy root
    ] as TreeEntry[];
    const assets = listSiteAssets(entries, theme).map((a) => a.path);
    expect(assets).toEqual([
      'themes/acme/assets/fonts/x.woff2',
      'themes/acme/assets/logo.png',
    ]);
    expect(siteAssetPath('My Logo.png', 'png', theme)).toBe('themes/acme/assets/my-logo.png');
  });

  it('findAssetReferences matches an asset by its full path and theme-relative form', () => {
    const sources = [
      { path: 'themes/acme/templates/default.liquid', text: '<img src="/assets/logo.png">' },
      { path: 'themes/acme/assets/theme.css', text: "background: url('fonts/x.woff2')" },
    ];
    // Full-path reference (template) — the published /assets path.
    expect(
      findAssetReferences('themes/acme/assets/logo.png', sources, theme),
    ).not.toContain('themes/acme/assets/theme.css');
    // Theme-relative reference (stylesheet url()).
    expect(findAssetReferences('themes/acme/assets/fonts/x.woff2', sources, theme)).toEqual([
      'themes/acme/assets/theme.css',
    ]);
  });
});
