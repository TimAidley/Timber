import { describe, expect, it } from 'vitest';
import {
  buildStarterFile,
  newFilePath,
  validateFileName,
} from '../src/advanced/newFile.js';
import { validateAdvancedFile } from '../src/advanced/validate.js';
import { parse as parseYaml } from 'yaml';

describe('newFilePath', () => {
  it('puts a template under templates/ with a .liquid extension', () => {
    expect(newFilePath({ kind: 'template', name: 'events' })).toBe(
      'templates/events.liquid',
    );
  });
  it('puts a style under assets/ with a .css extension', () => {
    expect(newFilePath({ kind: 'style', name: 'print' })).toBe('assets/print.css');
  });
  it('puts a config under config/ (not config/schemas) with a .yml extension', () => {
    expect(newFilePath({ kind: 'config', name: 'navigation' })).toBe(
      'config/navigation.yml',
    );
  });
});

describe('validateFileName', () => {
  const taken = new Set(['templates/default.liquid', 'config/navigation.yml']);

  it('accepts a slug-safe, unused name', () => {
    expect(validateFileName('template', 'events', taken)).toBeNull();
    expect(validateFileName('config', 'social-links', taken)).toBeNull();
  });
  it('requires a non-empty name', () => {
    expect(validateFileName('template', '   ', taken)).toMatch(/enter a file name/i);
  });
  it('rejects non-slug names (spaces, capitals, leading digit)', () => {
    expect(validateFileName('template', 'My Page', taken)).toMatch(/lowercase/i);
    expect(validateFileName('template', 'Events', taken)).toMatch(/lowercase/i);
    expect(validateFileName('config', '1nav', taken)).toMatch(/lowercase/i);
  });
  it('rejects a name whose resulting path already exists', () => {
    expect(validateFileName('template', 'default', taken)).toMatch(/already exists/i);
    expect(validateFileName('config', 'navigation', taken)).toMatch(/already exists/i);
  });
  it('is kind-scoped: the same name is free under a different kind', () => {
    // config/default.yml doesn't collide with templates/default.liquid.
    expect(validateFileName('config', 'default', taken)).toBeNull();
  });
});

describe('buildStarterFile', () => {
  it('generates a template that extends default and passes the commit-gate validator', () => {
    const src = buildStarterFile({ kind: 'template', name: 'events' });
    // Layout inheritance: fills only the `main` block, chrome stays in default.liquid.
    expect(src).toContain("{% layout 'default' %}");
    expect(src).toContain('{% block main %}');
    expect(src).toContain('{{ content }}');
    // A `{% layout %}` template still parses (the base is resolved at render, not parse),
    // so it commits like any valid template.
    expect(
      validateAdvancedFile({
        path: 'templates/events.liquid',
        kind: 'template',
        content: src,
      }).valid,
    ).toBe(true);
  });

  it('generates a style stub that is valid and names its own link path', () => {
    const src = buildStarterFile({ kind: 'style', name: 'print' });
    expect(src).toContain('assets/print.css');
    expect(
      validateAdvancedFile({ path: 'assets/print.css', kind: 'style', content: src })
        .valid,
    ).toBe(true);
  });

  it('generates a config stub that is valid (parseable) YAML', () => {
    const src = buildStarterFile({ kind: 'config', name: 'navigation' });
    // An all-comment doc parses to null — valid, empty structured data.
    expect(parseYaml(src)).toBeNull();
    expect(
      validateAdvancedFile({
        path: 'config/navigation.yml',
        kind: 'config',
        content: src,
      }).valid,
    ).toBe(true);
  });
});
