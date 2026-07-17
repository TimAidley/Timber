import type { FieldKind, FieldSchema } from './types.js';

/** Every known field kind — used to validate schema files themselves. */
export const FIELD_KINDS: readonly FieldKind[] = [
  'text',
  'multiline',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum',
  'tags',
  'color',
  'image',
  'reference',
  'video',
];

export function isFieldKind(value: unknown): value is FieldKind {
  return typeof value === 'string' && (FIELD_KINDS as readonly string[]).includes(value);
}

/** A JSON Schema fragment (loosely typed — we only ever build small object literals). */
export type JsonSchemaFragment = Record<string, unknown>;

/**
 * The hybrid's core: translate one authored field declaration into the JSON Schema
 * fragment Ajv validates against. This is an internal detail — schema authors write
 * `{ type: reference, referenceType: people }`, never JSON Schema.
 *
 * `reference`/`video`/`image` translate to plain strings here; their Timber-specific
 * semantics (id existence, provider allowlist) are separate passes in validate.ts,
 * because they can't be expressed in single-document JSON Schema.
 */
export function fieldToJsonSchema(field: FieldSchema): JsonSchemaFragment {
  switch (field.type) {
    case 'text':
    case 'multiline': {
      const schema: JsonSchemaFragment = { type: 'string' };
      if (field.required) schema.minLength = 1;
      if (typeof field.maxLength === 'number') schema.maxLength = field.maxLength;
      if (typeof field.pattern === 'string') schema.pattern = field.pattern;
      return schema;
    }
    case 'number': {
      const schema: JsonSchemaFragment = { type: 'number' };
      if (typeof field.min === 'number') schema.minimum = field.min;
      if (typeof field.max === 'number') schema.maximum = field.max;
      return schema;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return { type: 'string', format: 'date' };
    case 'datetime':
      return { type: 'string', format: 'date-time' };
    case 'enum':
      return { type: 'string', enum: field.options ?? [] };
    case 'tags':
      return { type: 'array', items: { type: 'string' } };
    case 'color':
      // Stored as a string; the picker only ever yields a valid `#rrggbb`, and the
      // generator re-validates the hex before it reaches CSS (defence in depth for a
      // hand-edited value), so no format constraint is imposed here.
      return field.required ? { type: 'string', minLength: 1 } : { type: 'string' };
    case 'image':
      return { type: 'string', minLength: 1 };
    case 'reference':
      return { type: 'string', minLength: 1 };
    case 'video':
      return { type: 'string', format: 'uri' };
  }
}
