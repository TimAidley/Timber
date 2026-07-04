import type {
  ContentModel,
  ContentObject,
  ContentTypeSchema,
  ModelError,
} from './types.js';

/** Resolve a reference id to its object (SPEC §5: references store id, display title). */
export function resolveReference(
  model: ContentModel,
  id: string,
): ContentObject | undefined {
  return model.byId.get(id);
}

/**
 * Build a human-readable URL for an object. Default pattern `/{type}/{slug}/`,
 * overridable per type via `schema.urlPattern`. (Homepage-at-root and redirect
 * stubs are Phase 7 concerns; this is the minimal form reference display needs.)
 */
export function urlFor(object: ContentObject, schema: ContentTypeSchema): string {
  const pattern = schema.urlPattern ?? '/{type}/{slug}/';
  return pattern.replace(/\{type\}/g, object.type).replace(/\{slug\}/g, object.slug);
}

/**
 * Every object with a `reference` field pointing at `id` — the inbound counterpart
 * to {@link detectDanglingReferences}. Powers the guarded-delete warning (SPEC §5:
 * "guarded by a warning that lists what references the object"), so a deletion that
 * would strand references is a deliberate choice, not silent breakage.
 */
export function referrersTo(model: ContentModel, id: string): ContentObject[] {
  const referrers: ContentObject[] = [];
  for (const object of model.objects) {
    if (object.id === id) continue; // an object referencing itself isn't a blocker
    const schema = model.schemas.get(object.type);
    if (!schema) continue;
    const hit = Object.entries(schema.fields).some(
      ([name, field]) => field.type === 'reference' && object.data[name] === id,
    );
    if (hit) referrers.push(object);
  }
  return referrers;
}

/**
 * Sweep every reference field across the model and report ids that don't resolve
 * (or resolve to the wrong `referenceType`). This is the model-wide dangling-
 * reference detection SPEC §5 calls for — resolve-first rather than silent breakage.
 */
export function detectDanglingReferences(model: ContentModel): ModelError[] {
  const dangling: ModelError[] = [];

  for (const object of model.objects) {
    const schema = model.schemas.get(object.type);
    if (!schema) continue;

    for (const [name, field] of Object.entries(schema.fields)) {
      if (field.type !== 'reference') continue;
      const value = object.data[name];
      if (typeof value !== 'string') continue;

      const target = model.byId.get(value);
      if (!target) {
        dangling.push({
          kind: 'dangling-reference',
          message: `"${object.path}" field "${name}" references missing id "${value}"`,
          paths: [object.path],
        });
      } else if (field.referenceType && target.type !== field.referenceType) {
        dangling.push({
          kind: 'dangling-reference',
          message: `"${object.path}" field "${name}" references a "${target.type}", expected "${field.referenceType}"`,
          paths: [object.path, target.path],
        });
      }
    }
  }

  return dangling;
}
