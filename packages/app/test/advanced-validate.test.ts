import { describe, expect, it } from 'vitest';
import { validateAdvancedFile } from '../src/advanced/validate.js';
import { kindOf } from '../src/advanced/loadAdvancedFiles.js';

describe('kindOf', () => {
  it('classifies templates, styles, schemas, and other config', () => {
    expect(kindOf('templates/default.liquid')).toBe('template');
    expect(kindOf('templates/pages.liquid')).toBe('template');
    expect(kindOf('assets/theme.css')).toBe('style');
    expect(kindOf('assets/print.css')).toBe('style');
    expect(kindOf('assets/css/nested.css')).toBe('style');
    expect(kindOf('config/schemas/pages.yml')).toBe('schema');
    expect(kindOf('config/navigation.yml')).toBe('config');
    expect(kindOf('config/settings.yaml')).toBe('config');
  });

  it('ignores content and non-CSS assets (fonts/images need a binary manager, not this text loop)', () => {
    expect(kindOf('content/pages/hello/index.md')).toBeUndefined();
    expect(kindOf('assets/fonts/source-serif.woff2')).toBeUndefined();
    expect(kindOf('assets/logo.webp')).toBeUndefined();
    expect(kindOf('README.md')).toBeUndefined();
  });
});

describe('validateAdvancedFile — templates (engine.parse)', () => {
  it('accepts a valid Liquid template', () => {
    const file = {
      path: 'templates/default.liquid',
      kind: 'template' as const,
      content: '<h1>{{ page.title }}</h1>{% for item in site.nav %}{{ item.label }}{% endfor %}',
    };
    expect(validateAdvancedFile(file)).toEqual({ valid: true, errors: [] });
  });

  it('rejects a template with an unclosed tag (the build would choke)', () => {
    const file = {
      path: 'templates/default.liquid',
      kind: 'template' as const,
      content: '<h1>{{ page.title }}</h1>{% for item in site.nav %}{{ item.label }}',
    };
    const result = validateAdvancedFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/template syntax error/i);
  });
});

describe('validateAdvancedFile — schemas (loadSchemas)', () => {
  it('accepts a well-formed schema', () => {
    const file = {
      path: 'config/schemas/pages.yml',
      kind: 'schema' as const,
      content: 'name: Pages\nkind: collection\nfields:\n  title:\n    type: text\n    required: true\n',
    };
    expect(validateAdvancedFile(file).valid).toBe(true);
  });

  it('rejects a schema with an unknown field type', () => {
    const file = {
      path: 'config/schemas/pages.yml',
      kind: 'schema' as const,
      content: 'name: Pages\nkind: collection\nfields:\n  title:\n    type: wat\n',
    };
    const result = validateAdvancedFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown type/i);
  });

  it('rejects malformed schema YAML', () => {
    const file = {
      path: 'config/schemas/pages.yml',
      kind: 'schema' as const,
      content: 'name: Pages\n  kind: : collection\n',
    };
    expect(validateAdvancedFile(file).valid).toBe(false);
  });
});

describe('validateAdvancedFile — style (CSS)', () => {
  // The build copies assets/** verbatim, so there's no CSS gate to mirror: any CSS
  // is committable (a false "invalid" would only wrongly block a valid save).
  it('treats any CSS as valid, including gibberish', () => {
    for (const content of [
      ':root { --fg: #111; }\nbody { color: var(--fg); }\n',
      'this is not valid css at all {{{',
      '',
    ]) {
      expect(validateAdvancedFile({ path: 'assets/theme.css', kind: 'style', content }).valid).toBe(
        true,
      );
    }
  });
});

describe('validateAdvancedFile — config (YAML)', () => {
  it('accepts well-formed navigation config', () => {
    const file = {
      path: 'config/navigation.yml',
      kind: 'config' as const,
      content: '- label: Home\n  ref: home\n- label: About\n  url: /about/\n',
    };
    expect(validateAdvancedFile(file).valid).toBe(true);
  });

  it('rejects malformed YAML', () => {
    const file = {
      path: 'config/navigation.yml',
      kind: 'config' as const,
      content: '- label: Home\n  ref: : home\n:::\n',
    };
    const result = validateAdvancedFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/invalid yaml/i);
  });
});
