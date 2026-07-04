import { parse as parseYaml } from 'yaml';
import { isFieldKind } from './fields.js';
import type {
  ContentTypeKind,
  ContentTypeSchema,
  FieldSchema,
  RepoSnapshot,
} from './types.js';

const SCHEMA_PATH = /^config\/schemas\/([^/]+)\.ya?ml$/;

/** Thrown when a schema file is structurally invalid (a build-blocking config error). */
export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseField(name: string, raw: unknown, where: string): FieldSchema {
  const rec = asRecord(raw);
  if (!rec) throw new SchemaError(`${where}: field "${name}" must be a mapping`);
  if (!isFieldKind(rec.type)) {
    throw new SchemaError(`${where}: field "${name}" has unknown type "${String(rec.type)}"`);
  }

  const field: FieldSchema = { type: rec.type };
  if (rec.required !== undefined) field.required = Boolean(rec.required);
  if (typeof rec.label === 'string') field.label = rec.label;
  if (typeof rec.referenceType === 'string') field.referenceType = rec.referenceType;
  if (typeof rec.maxLength === 'number') field.maxLength = rec.maxLength;
  if (typeof rec.pattern === 'string') field.pattern = rec.pattern;
  if (typeof rec.min === 'number') field.min = rec.min;
  if (typeof rec.max === 'number') field.max = rec.max;

  if (rec.type === 'enum') {
    if (!Array.isArray(rec.options) || rec.options.length === 0) {
      throw new SchemaError(`${where}: enum field "${name}" needs a non-empty "options" list`);
    }
    field.options = rec.options.map((o) => String(o));
  }

  return field;
}

function parseSchema(name: string, raw: unknown, where: string): ContentTypeSchema {
  const rec = asRecord(raw);
  if (!rec) throw new SchemaError(`${where}: schema must be a mapping`);

  const kind = rec.kind;
  if (kind !== 'collection' && kind !== 'singleton') {
    throw new SchemaError(`${where}: "kind" must be "collection" or "singleton"`);
  }

  const fieldsRaw = asRecord(rec.fields) ?? {};
  const fields: Record<string, FieldSchema> = {};
  for (const [fieldName, fieldRaw] of Object.entries(fieldsRaw)) {
    fields[fieldName] = parseField(fieldName, fieldRaw, where);
  }

  const schema: ContentTypeSchema = { name, kind: kind as ContentTypeKind, fields };
  if (typeof rec.urlPattern === 'string') schema.urlPattern = rec.urlPattern;
  if (rec.hasBody !== undefined) schema.hasBody = Boolean(rec.hasBody);
  return schema;
}

/**
 * Load all content-type schemas from `config/schemas/<name>.yml` in the snapshot.
 * The type name is the file's basename. Throws {@link SchemaError} on a malformed
 * schema — a broken schema is a config error that blocks validating any content.
 */
export function loadSchemas(snapshot: RepoSnapshot): Map<string, ContentTypeSchema> {
  const schemas = new Map<string, ContentTypeSchema>();
  for (const [path, contents] of snapshot) {
    const match = SCHEMA_PATH.exec(path);
    if (!match) continue;
    const name = match[1]!;

    let raw: unknown;
    try {
      raw = parseYaml(contents);
    } catch (err) {
      throw new SchemaError(`${path}: invalid YAML — ${(err as Error).message}`);
    }

    schemas.set(name, parseSchema(name, raw, path));
  }
  return schemas;
}
