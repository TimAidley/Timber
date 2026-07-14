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
  it('generates a template that passes the same validator the commit gate uses', () => {
    const src = buildStarterFile({ kind: 'template', name: 'events' });
    expect(src).toContain('{{ content }}');
    expect(
      validateAdvancedFile({
        path: 'templates/events.liquid',
        kind: 'template',
        content: src,
      }).valid,
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
