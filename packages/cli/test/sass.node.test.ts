import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '@timber/generator';
import { compileThemeStylesheet } from '../src/sass.node.js';

/**
 * Node/CLI-side Sass, proven against the REAL Minima SCSS (vendored under
 * test/fixtures/minima-theme, MIT): front matter + a Liquid-interpolated skin `@import`,
 * resolved through the generator engine (so the skin choice is preview ≡ build), then
 * compiled with dart-sass resolving `@import`s against the theme's `_sass`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const THEME = join(here, 'fixtures', 'minima-theme');

// Resolve Liquid in the SCSS with the real generator engine (the skin interpolation uses the
// built-in `default` filter → 'classic' when no skin is set).
const engine = createEngine();
const resolve = (scss: string): Promise<string> =>
  engine.parseAndRender(scss, { site: { minima: {} } });

describe('compileThemeStylesheet (Node/CLI-side Sass)', () => {
  it('compiles real Minima SCSS to CSS, resolving the Liquid skin @import', async () => {
    const source = await readFile(join(THEME, 'assets', 'css', 'style.scss'), 'utf8');
    const css = await compileThemeStylesheet({
      source,
      loadPaths: [join(THEME, '_sass')],
      resolve,
    });
    expect(css.length).toBeGreaterThan(1000); // a real stylesheet, not empty
    expect(css).toContain('.site-header'); // a known Minima selector (from _layout.scss)
    expect(css).not.toContain('@import'); // partials were resolved/inlined
    expect(css).not.toContain('{{'); // the Liquid skin interpolation was resolved
  });

  it('strips the Jekyll front-matter fence before compiling', async () => {
    const css = await compileThemeStylesheet({
      source: '---\n---\n.x { color: red; }',
      style: 'expanded',
    });
    expect(css).toContain('.x');
    expect(css).toContain('red');
  });

  it('compiles plain SCSS (no front matter, no Liquid) too', async () => {
    const css = await compileThemeStylesheet({
      source: '$c: blue; a { color: $c; }',
      style: 'compressed',
    });
    expect(css).toContain('color:blue');
  });
});
