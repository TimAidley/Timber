import { describe, expect, it } from 'vitest';
import {
  buildSchemaYaml,
  defaultsForKind,
  schemaNameFromPath,
  schemaPathFor,
  validateTypeName,
} from '../src/advanced/schemaTemplate.js';
import { validateAdvancedFile } from '../src/advanced/validate.js';
import { parse as parseYaml } from 'yaml';

describe('defaultsForKind', () => {
  it('a collection is a page with a body', () => {
    expect(defaultsForKind('collection')).toEqual({ page: true, hasBody: true });
  });
  it('a singleton defaults to settings-style config (no page, no body)', () => {
    expect(defaultsForKind('singleton')).toEqual({ page: false, hasBody: false });
  });
});

describe('schemaPathFor / schemaNameFromPath', () => {
  it('round-trips a type name through its schema path', () => {
    expect(schemaPathFor('events')).toBe('config/schemas/events.yml');
    expect(schemaNameFromPath('config/schemas/events.yml')).toBe('events');
    expect(schemaNameFromPath('config/schemas/events.yaml')).toBe('events');
  });
  it('ignores non-schema paths (only config/schemas/* are types)', () => {
    expect(schemaNameFromPath('templates/default.liquid')).toBeUndefined();
    expect(schemaNameFromPath('config/navigation.yml')).toBeUndefined();
  });
});

describe('validateTypeName', () => {
  const taken = new Set(['pages', 'settings']);

  it('accepts a slug-safe, unused name', () => {
    expect(validateTypeName('events', taken)).toBeNull();
    expect(validateTypeName('blog-posts', taken)).toBeNull();
  });
  it('requires a non-empty name', () => {
    expect(validateTypeName('   ', taken)).toMatch(/enter a name/i);
  });
  it('rejects non-slug names (spaces, capitals, leading digit)', () => {
    expect(validateTypeName('My Events', taken)).toMatch(/lowercase/i);
    expect(validateTypeName('Events', taken)).toMatch(/lowercase/i);
    expect(validateTypeName('1events', taken)).toMatch(/lowercase/i);
  });
  it('rejects a name already taken', () => {
    expect(validateTypeName('pages', taken)).toMatch(/already exists/i);
  });
});

describe('buildSchemaYaml', () => {
  it('generates a valid schema for a collection page with a body', () => {
    const yaml = buildSchemaYaml({
      name: 'events',
      kind: 'collection',
      page: true,
      hasBody: true,
    });
    const parsed = parseYaml(yaml);
    expect(parsed).toMatchObject({
      kind: 'collection',
      hasBody: true,
      fields: { title: { type: 'text', required: true } },
    });
    // page defaults to true in the generator, so it's not emitted redundantly.
    expect(parsed).not.toHaveProperty('page');
    // Passes the same validator the commit gate uses.
    expect(
      validateAdvancedFile({
        path: 'config/schemas/events.yml',
        kind: 'schema',
        content: yaml,
      }).valid,
    ).toBe(true);
  });

  it('generates a valid settings-style singleton (no page, no body, optional title)', () => {
    const yaml = buildSchemaYaml({
      name: 'settings',
      kind: 'singleton',
      page: false,
      hasBody: false,
    });
    const parsed = parseYaml(yaml);
    expect(parsed).toMatchObject({ kind: 'singleton', hasBody: false, page: false });
    expect(parsed.fields.title).toEqual({ type: 'text' }); // not required (not a page)
    expect(
      validateAdvancedFile({
        path: 'config/schemas/settings.yml',
        kind: 'schema',
        content: yaml,
      }).valid,
    ).toBe(true);
  });

  it('marks title required whenever the type renders as a page', () => {
    const yaml = buildSchemaYaml({
      name: 'home',
      kind: 'singleton',
      page: true,
      hasBody: true,
    });
    const parsed = parseYaml(yaml);
    expect(parsed.fields.title).toEqual({ type: 'text', required: true });
    expect(parsed).not.toHaveProperty('page'); // page: true is the default, omitted
  });
});
