import { describe, expect, it } from 'vitest';
import { findAssetReferences } from '../src/media/assetReferences.js';

describe('findAssetReferences', () => {
  const template = {
    path: 'templates/default.liquid',
    text: '<link rel="icon" href="{{ site.basePath }}/assets/favicon.ico" />',
  };
  const css = {
    path: 'assets/theme.css',
    text: "@font-face { src: url('fonts/source-serif.woff2') format('woff2'); }",
  };

  it('finds a full-path reference in a template', () => {
    expect(findAssetReferences('assets/favicon.ico', [template, css])).toEqual([
      'templates/default.liquid',
    ]);
  });

  it('finds an assets-relative reference in a stylesheet', () => {
    expect(findAssetReferences('assets/fonts/source-serif.woff2', [template, css])).toEqual([
      'assets/theme.css',
    ]);
  });

  it('returns every source that references the asset', () => {
    const both = {
      path: 'templates/page.liquid',
      text: 'background: url(/assets/fonts/source-serif.woff2)',
    };
    expect(
      findAssetReferences('assets/fonts/source-serif.woff2', [both, css]).sort(),
    ).toEqual(['assets/theme.css', 'templates/page.liquid']);
  });

  it('returns [] when nothing references the asset', () => {
    expect(findAssetReferences('assets/unused.webp', [template, css])).toEqual([]);
  });

  it('does not match a longer filename that merely contains the name', () => {
    const near = { path: 'templates/x.liquid', text: 'href="/assets/my-logo.webproj"' };
    expect(findAssetReferences('assets/logo.webp', [near])).toEqual([]);
  });

  it('matches a name that is a substring boundary-cleanly', () => {
    const exact = { path: 'templates/x.liquid', text: 'href="/assets/logo.webp?v=2"' };
    expect(findAssetReferences('assets/logo.webp', [exact])).toEqual(['templates/x.liquid']);
  });
});
