import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { fieldToJsonSchema } from './fields.js';
import { parseVideoUrl } from './video.js';
import type {
  ContentModel,
  ContentObject,
  ContentTypeSchema,
  FieldError,
  ValidationResult,
} from './types.js';

/**
 * Compile a content type's authored schema into a single tolerant JSON Schema.
 * Tolerant (SPEC §5): `additionalProperties` is left permissive so undeclared
 * front-matter keys pass through — only declared fields are constrained.
 */
function buildTypeJsonSchema(schema: ContentTypeSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(schema.fields)) {
    properties[name] = fieldToJsonSchema(field);
    if (field.required) required.push(name);
  }
  return { type: 'object', properties, required };
}

/**
 * A reusable validator over a fixed set of schemas. Ajv compilation is cached per
 * content type. `validateObject` runs Ajv, then the two Timber-specific semantic
 * passes (reference existence, video allowlist) that single-document JSON Schema
 * can't express.
 */
export class Validator {
  private readonly ajv: Ajv;
  private readonly compiled = new Map<string, ValidateFunction>();

  constructor(private readonly schemas: Map<string, ContentTypeSchema>) {
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
  }

  private validatorFor(schema: ContentTypeSchema): ValidateFunction {
    let fn = this.compiled.get(schema.name);
    if (!fn) {
      fn = this.ajv.compile(buildTypeJsonSchema(schema));
      this.compiled.set(schema.name, fn);
    }
    return fn;
  }

  validateObject(object: ContentObject, model: ContentModel): ValidationResult {
    const schema = this.schemas.get(object.type);
    if (!schema) {
      return {
        valid: false,
        errors: [{ message: `unknown content type "${object.type}"` }],
      };
    }

    const errors: FieldError[] = [];

    // 1. Structural validation via Ajv.
    const validate = this.validatorFor(schema);
    if (!validate(object.data) && validate.errors) {
      for (const err of validate.errors) {
        const field = err.instancePath.replace(/^\//, '') || undefined;
        errors.push({
          ...(field ? { field } : {}),
          message: `${field ?? 'object'} ${err.message ?? 'is invalid'}`.trim(),
        });
      }
    }

    // 2. Timber-specific semantic checks over declared fields.
    for (const [name, field] of Object.entries(schema.fields)) {
      const value = object.data[name];
      if (value === undefined || value === null) continue;

      if (field.type === 'reference' && typeof value === 'string') {
        const target = model.byId.get(value);
        if (!target) {
          errors.push({ field: name, message: `reference "${value}" does not resolve` });
        } else if (field.referenceType && target.type !== field.referenceType) {
          errors.push({
            field: name,
            message: `reference "${value}" points to a "${target.type}", expected "${field.referenceType}"`,
          });
        }
      }

      if (field.type === 'video' && typeof value === 'string' && !parseVideoUrl(value)) {
        errors.push({
          field: name,
          message: `video URL "${value}" is not from an allowed provider`,
        });
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
