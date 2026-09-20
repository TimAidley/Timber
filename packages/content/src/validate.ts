import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { fieldToJsonSchema } from './fields.js';
import { validateEmbedBlocks } from './embeds.js';
import { validateFigureBlocks } from './figures.js';
import { validatePaginate } from './pagination.js';
import { shadowedAliases } from './redirects.js';
import { embedUrlProblem } from '@timber/generator';
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

      // `video` is the deprecated spelling of `embed` and resolves identically.
      if (
        (field.type === 'embed' || field.type === 'video') &&
        typeof value === 'string'
      ) {
        const problem = embedUrlProblem(value);
        if (problem) {
          errors.push({ field: name, message: `embed URL "${value}" ${problem}` });
        }
      }
    }

    // 3. Body-level checks: embedded image figures (SPEC §7 — alt mandatory, bounded
    //    layout/size) and `::embed` blocks (a URL that resolves, bounded mode/ratio).
    //    Same tolerant rule as the rest: these block *publish*, not save.
    if (object.body) {
      errors.push(...validateFigureBlocks(object.body));
      errors.push(...validateEmbedBlocks(object.body));
    }

    // 4. Paginated listings (SPEC §13). `paginate` is an undeclared, tolerated front-matter
    //    key, so nothing constrains it above — but a malformed block would emit a listing
    //    page with nothing on it, so it blocks publish like any other error.
    errors.push(...validatePaginate(object, this.schemas));

    // 5. Stale redirect aliases (SPEC §5). An alias whose old URL is now a live page's
    //    address can't redirect anywhere — the page and the stub would fight over one
    //    `index.html` — so it's reported here, on the object that carries it, with the
    //    one-line fix. Blocks publish like any other error, since a stub the build has to
    //    drop is a promise the site no longer keeps.
    for (const shadow of shadowedAliases(object, schema, model)) {
      const title = String(shadow.by.data.title ?? shadow.by.slug);
      errors.push({
        field: 'aliases',
        message: `alias "${shadow.alias}" points at ${shadow.url}, where the page "${title}" (${shadow.by.path}) now lives — remove the alias`,
      });
    }

    return { valid: errors.length === 0, errors };
  }
}
