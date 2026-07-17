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
 *
 * Multilingual (SPEC §5 → Multilingual): when the object carries a `lang` (i.e. the
 * site is i18n-enabled), the URL is language-prefixed — `/{lang}/{type}/{slug}/` —
 * uniformly for every language including the default. A pattern may instead place the
 * language itself via a `{lang}` placeholder, in which case it is substituted and the
 * automatic prefix is skipped. A `lang`-less object (single-language site) is unchanged.
 */
export function urlFor(object: ContentObject, schema: ContentTypeSchema): string {
  const pattern = schema.urlPattern ?? '/{type}/{slug}/';
  let url = pattern.replace(/\{type\}/g, object.type).replace(/\{slug\}/g, object.slug);
  if (pattern.includes('{lang}')) {
    url = url.replace(/\{lang\}/g, object.lang ?? '').replace(/\/{2,}/g, '/');
  } else if (object.lang) {
    url = `/${object.lang}${url}`;
  }
  return url;
}

/** One sibling translation of an object, for a language switcher / `hreflang` alternates. */
export interface Translation {
  /** BCP-47 language code of this sibling. */
  lang: string;
  /** The sibling's resolved URL. */
  url: string;
  /** The sibling's title (falls back to its slug). */
  title: string;
}

/**
 * The translations of an object (SPEC §5 → Multilingual): every sibling sharing its
 * `translationKey`, **including the object itself**, so a template can render a full
 * language switcher and mark the current language active. Sorted by language code for a
 * stable order. Empty when the object has no `translationKey` (single-language content).
 *
 * `urlOf` is injected (defaulting to {@link urlFor}) so callers that route specially —
 * e.g. the CLI's homepage-at-root — get matching URLs here, keeping preview ≡ build.
 */
export function translationsOf(
  model: ContentModel,
  object: ContentObject,
  urlOf: (o: ContentObject, s: ContentTypeSchema) => string = urlFor,
): Translation[] {
  if (!object.translationKey) return [];
  const group = model.byTranslation.get(object.translationKey);
  if (!group) return [];
  const out: Translation[] = [];
  for (const [lang, sibling] of group) {
    const schema = model.schemas.get(sibling.type);
    if (!schema) continue;
    const title =
      typeof sibling.data.title === 'string' && sibling.data.title
        ? sibling.data.title
        : sibling.slug;
    out.push({ lang, url: urlOf(sibling, schema), title });
  }
  out.sort((a, b) => (a.lang < b.lang ? -1 : a.lang > b.lang ? 1 : 0));
  return out;
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
