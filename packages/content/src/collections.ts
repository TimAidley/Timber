import type { FrontMatter } from '@timber/generator';
import type { ContentModel, ContentObject, ContentTypeSchema } from './types.js';
import { isPublic } from './visibility.js';

/**
 * One entry in a template-facing collection: an object's front-matter fields plus a
 * few computed conveniences. Templates read these to render listing pages, e.g.
 * `{% for post in collections.posts %}{{ post.title }} → {{ post.url }}{% endfor %}`.
 *
 * The computed keys (`url`, `slug`, `id`) are added last, so they win over any
 * same-named front-matter field — `url` is always the resolved, homepage-aware URL,
 * never a raw front-matter value.
 */
export interface CollectionEntry extends FrontMatter {
  /** Immutable front-matter identity, if the object has one. */
  id?: string;
  /** The object's folder name. */
  slug: string;
  /** The object's resolved, human-readable URL (homepage-at-root aware). */
  url: string;
}

/** Template-facing `{{ collections }}`: collection-type name → its public entries. */
export type Collections = Record<string, CollectionEntry[]>;

/**
 * The field a collection sorts by: the type's **first** `date`/`datetime` field, in
 * schema declaration order. ISO-8601 date/datetime values sort correctly as strings,
 * so no parsing is needed. Types with no date field fall back to slug order.
 */
function sortField(schema: ContentTypeSchema): string | undefined {
  for (const [name, field] of Object.entries(schema.fields)) {
    if (field.type === 'date' || field.type === 'datetime') return name;
  }
  return undefined;
}

/** Read a field as a sortable string; non-strings (missing/number/etc.) become ''. */
function key(entry: CollectionEntry, field: string): string {
  const value = entry[field];
  return typeof value === 'string' ? value : '';
}

/**
 * Assemble the template-facing `collections` context (SPEC §6): for every
 * **collection-kind** type, the list of its **public** objects as {@link CollectionEntry}
 * records. Singletons (e.g. the settings type) are excluded — they reach templates via
 * `{{ site }}`, not here.
 *
 * Entries are sorted **most-recent-first**: descending by the type's first date/datetime
 * field (see {@link sortField}), objects missing that value sorting last, with slug as a
 * deterministic tiebreak so the order is stable across builds.
 *
 * `urlOf` is injected (rather than calling `urlFor` directly) so the URLs here match the
 * caller's routing exactly — including homepage-at-root — keeping preview ≡ build (SPEC §6).
 * Every page is given the full `collections` map; if that ever costs too much for a huge
 * site we can scope it per-template, but it is not worth the complexity yet.
 */
export function assembleCollections(
  model: ContentModel,
  urlOf: (object: ContentObject, schema: ContentTypeSchema) => string,
): Collections {
  const collections: Collections = {};

  for (const object of model.objects) {
    const schema = model.schemas.get(object.type);
    if (!schema || schema.kind !== 'collection') continue;
    if (!isPublic(object)) continue;

    const entry: CollectionEntry = {
      ...object.data,
      slug: object.slug,
      url: urlOf(object, schema),
    };
    // Only referenceable objects carry an `id`; omit the key entirely otherwise
    // (`exactOptionalPropertyTypes` forbids an explicit `undefined`).
    if (object.id !== undefined) entry.id = object.id;
    (collections[object.type] ??= []).push(entry);
  }

  for (const [type, entries] of Object.entries(collections)) {
    const field = sortField(model.schemas.get(type)!);
    entries.sort((a, b) => {
      if (field) {
        const av = key(a, field);
        const bv = key(b, field);
        if (av !== bv) {
          if (!av) return 1; // missing date sorts last
          if (!bv) return -1;
          return av < bv ? 1 : -1; // descending: most recent first
        }
      }
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  return collections;
}
