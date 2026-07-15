import { describe, expect, it } from 'vitest';
import type { TreeEntry } from '@timber/github';
import { categorize, isThumbnailable, listSiteAssets } from '../src/media/siteAssets.js';

function blob(path: string, size?: number): TreeEntry {
  return { path, type: 'blob', sha: 'x', ...(size !== undefined ? { size } : {}) };
}

describe('categorize', () => {
  it('maps extensions to display categories', () => {
    expect(categorize('png')).toBe('image');
    expect(categorize('svg')).toBe('image');
    expect(categorize('ico')).toBe('icon');
    expect(categorize('woff2')).toBe('font');
    expect(categorize('pdf')).toBe('document');
    expect(categorize('css')).toBe('style');
    expect(categorize('json')).toBe('other');
  });
});

describe('listSiteAssets', () => {
  it('keeps only blobs under assets/, sorted by path, classified', () => {
    const assets = listSiteAssets([
      blob('assets/theme.css', 100),
      blob('assets/fonts/serif.woff2', 5000),
      blob('assets/logo.webp', 2000),
      blob('content/pages/home/index.md', 50), // not under assets/
      blob('templates/default.liquid', 80), // not under assets/
      { path: 'assets/fonts', type: 'tree', sha: 'y' }, // a folder, not a blob
    ]);
    expect(assets.map((a) => a.path)).toEqual([
      'assets/fonts/serif.woff2',
      'assets/logo.webp',
      'assets/theme.css',
    ]);
    expect(assets.map((a) => a.category)).toEqual(['font', 'image', 'style']);
    expect(assets[0]).toMatchObject({ name: 'serif.woff2', ext: 'woff2', size: 5000 });
  });

  it('tolerates a missing size', () => {
    const [asset] = listSiteAssets([blob('assets/logo.svg')]);
    expect(asset?.size).toBeUndefined();
    expect(asset?.category).toBe('image');
  });

  it('marks only images as thumbnailable', () => {
    const assets = listSiteAssets([
      blob('assets/a.png'),
      blob('assets/b.woff2'),
      blob('assets/c.ico'),
    ]);
    expect(assets.map(isThumbnailable)).toEqual([true, false, false]);
  });
});
