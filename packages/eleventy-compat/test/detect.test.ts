import { describe, it, expect } from 'vitest';
import { jekyllEngine, type ThemeFiles } from '@timber/jekyll-compat';
import { detectEngine, engineByName, engineName } from '../src/detect.js';
import { eleventyEngine } from '../src/engine.js';

const t = (paths: string[]): ThemeFiles => ({
  text: Object.fromEntries(paths.map((p) => [p, ''])),
});

describe('detectEngine', () => {
  it('detects Jekyll from _layouts/*.html', () => {
    expect(detectEngine(t(['_layouts/default.html', 'assets/main.scss']))).toBe(jekyllEngine);
  });

  it('detects Eleventy from _includes/*.liquid', () => {
    expect(detectEngine(t(['_includes/layouts/base.liquid', '_data/site.json']))).toBe(
      eleventyEngine,
    );
  });

  it('detects Eleventy from a src/-rooted layout + config file', () => {
    expect(detectEngine(t(['eleventy.config.js', 'src/_includes/base.liquid']))).toBe(
      eleventyEngine,
    );
  });

  it('prefers Jekyll when both signatures are present (the original path)', () => {
    expect(detectEngine(t(['_layouts/default.html', '_includes/head.liquid']))).toBe(
      jekyllEngine,
    );
  });

  it('defaults to Jekyll for an ambiguous theme', () => {
    expect(detectEngine(t(['assets/style.css']))).toBe(jekyllEngine);
  });
});

describe('engineByName / engineName', () => {
  it('maps names to engines and back', () => {
    expect(engineByName('eleventy')).toBe(eleventyEngine);
    expect(engineByName('jekyll')).toBe(jekyllEngine);
    expect(engineByName(undefined)).toBe(jekyllEngine);
    expect(engineName(eleventyEngine)).toBe('eleventy');
    expect(engineName(jekyllEngine)).toBe('jekyll');
  });
});
