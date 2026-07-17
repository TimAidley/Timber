import { describe, expect, it } from 'vitest';
import { fieldToJsonSchema, isFieldKind } from '../src/fields.js';
import { loadSchemas } from '../src/schema.js';

describe('color field type', () => {
  it('is a recognised field kind', () => {
    expect(isFieldKind('color')).toBe(true);
  });

  it('maps to a plain string (validation of the hex is the generator/picker’s job)', () => {
    expect(fieldToJsonSchema({ type: 'color' })).toEqual({ type: 'string' });
    expect(fieldToJsonSchema({ type: 'color', required: true })).toEqual({
      type: 'string',
      minLength: 1,
    });
  });

  it('parses in a schema file like any other field', () => {
    const schemas = loadSchemas(
      new Map([
        [
          'config/schemas/settings.yml',
          'kind: singleton\npage: false\nfields:\n  accentColor:\n    type: color\n    label: Accent colour\n',
        ],
      ]),
    );
    expect(schemas.get('settings')?.fields.accentColor).toEqual({
      type: 'color',
      label: 'Accent colour',
    });
  });
});
