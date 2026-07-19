import { describe, it, expect } from 'vitest';
import { compileScss } from '../src/index.js';

describe('compileScss', () => {
  it('compiles plain SCSS (variables + nesting)', async () => {
    expect(await compileScss({ source: '$c: teal; a { b { color: $c; } }' })).toBe(
      'a b{color:teal}',
    );
  });

  it('resolves @import from a load path (underscore partial)', async () => {
    const css = await compileScss({
      source: '@import "vars"; a { color: $c; }',
      files: { 'sass/_vars.scss': '$c: red;' },
      loadPaths: ['sass'],
    });
    expect(css).toBe('a{color:red}');
  });

  it('resolves an index file (dir/index.scss)', async () => {
    const css = await compileScss({
      source: '@import "theme"; a { color: $c; }',
      files: { 'sass/theme/index.scss': '$c: green;' },
      loadPaths: ['sass'],
    });
    expect(css).toBe('a{color:green}');
  });

  it('resolves a nested import relative to the importing partial', async () => {
    const css = await compileScss({
      source: '@import "a"; .x { color: $c; }',
      files: {
        'sass/_a.scss': '@import "b";', // relative to sass/
        'sass/_b.scss': '$c: teal;',
      },
      loadPaths: ['sass'],
    });
    expect(css).toBe('.x{color:teal}');
  });

  it('resolves imports relative to the entry file’s own directory', async () => {
    const css = await compileScss({
      source: '@import "local"; a { color: $c; }',
      entryPath: 'assets/css/style.scss',
      files: { 'assets/css/_local.scss': '$c: navy;' },
    });
    expect(css).toBe('a{color:navy}');
  });

  it('applies the Liquid resolver before compiling (skin interpolation)', async () => {
    const css = await compileScss({
      source: '@import "skins/{{ skin }}"; a { color: $c; }',
      files: { 'sass/skins/_dark.scss': '$c: black;' },
      loadPaths: ['sass'],
      resolve: (scss) => scss.replace(/\{\{[^}]*\}\}/g, 'dark'),
    });
    expect(css).toBe('a{color:#000}'); // dart-sass compresses `black` → `#000`
  });

  it('strips a Jekyll front-matter fence', async () => {
    expect(await compileScss({ source: '---\n---\na { color: red; }' })).toBe(
      'a{color:red}',
    );
  });

  it('honors an expanded output style', async () => {
    const css = await compileScss({ source: 'a{color:red}', style: 'expanded' });
    expect(css).toContain('color: red;');
  });
});
