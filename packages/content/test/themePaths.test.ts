import { describe, it, expect } from 'vitest';
import {
  resolveThemePaths,
  assetSourceDirs,
  assetOutputPath,
} from '../src/themePaths.js';

describe('resolveThemePaths', () => {
  it('uses the legacy root when no theme is active (every pre-themes site)', () => {
    const t = resolveThemePaths(undefined, () => false);
    expect(t).toEqual({
      name: null,
      templatesDir: 'templates',
      assetsDir: 'assets',
      sassLoadPaths: ['assets/_sass'],
    });
  });

  it('scopes to themes/<name>/ when the active theme exists', () => {
    const t = resolveThemePaths('default', (n) => n === 'default');
    expect(t).toEqual({
      name: 'default',
      templatesDir: 'themes/default/templates',
      assetsDir: 'themes/default/assets',
      sassLoadPaths: ['themes/default/assets/_sass', 'assets/_sass'],
    });
  });

  it('falls back to legacy when activeTheme names a missing folder (dangling setting)', () => {
    const t = resolveThemePaths('ghost', () => false);
    expect(t.name).toBeNull();
    expect(t.templatesDir).toBe('templates');
  });
});

describe('assetSourceDirs', () => {
  it('is just assets/ in legacy mode', () => {
    const t = resolveThemePaths(undefined, () => false);
    expect(assetSourceDirs(t)).toEqual(['assets']);
  });

  it('is theme assets then site assets (site overrides) in theme mode', () => {
    const t = resolveThemePaths('default', () => true);
    expect(assetSourceDirs(t)).toEqual(['themes/default/assets', 'assets']);
  });
});

describe('assetOutputPath', () => {
  const themed = resolveThemePaths('default', () => true);
  const legacy = resolveThemePaths(undefined, () => false);

  it('strips the theme prefix so theme assets publish under /assets', () => {
    expect(assetOutputPath('themes/default/assets/theme.css', themed)).toBe(
      'assets/theme.css',
    );
    expect(assetOutputPath('themes/default/assets/fonts/x.woff2', themed)).toBe(
      'assets/fonts/x.woff2',
    );
  });

  it('leaves a site-level upload where it is', () => {
    expect(assetOutputPath('assets/logo.png', themed)).toBe('assets/logo.png');
    expect(assetOutputPath('assets/theme.css', legacy)).toBe('assets/theme.css');
  });

  it('returns null for a path under neither asset root', () => {
    expect(assetOutputPath('content/x/index.md', themed)).toBeNull();
    expect(assetOutputPath('themes/other/assets/x.css', themed)).toBeNull();
  });
});
