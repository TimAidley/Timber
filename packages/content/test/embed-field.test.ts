import { describe, expect, it } from 'vitest';
import { fieldToJsonSchema, isFieldKind } from '../src/fields.js';
import { loadSchemas } from '../src/schema.js';

describe('embed field type', () => {
  it('is a recognised field kind, as is the deprecated `video` spelling', () => {
    expect(isFieldKind('embed')).toBe(true);
    expect(isFieldKind('video')).toBe(true);
  });

  it('maps both spellings to a URI string', () => {
    expect(fieldToJsonSchema({ type: 'embed' })).toEqual({
      type: 'string',
      format: 'uri',
    });
    expect(fieldToJsonSchema({ type: 'video' })).toEqual({
      type: 'string',
      format: 'uri',
    });
  });

  it('parses in a schema file like any other field', () => {
    const schemas = loadSchemas(
      new Map([
        [
          'config/schemas/projects.yml',
          'kind: collection\nfields:\n  game:\n    type: embed\n    label: Playable build\n',
        ],
      ]),
    );
    expect(schemas.get('projects')?.fields.game).toEqual({
      type: 'embed',
      label: 'Playable build',
    });
  });
});
