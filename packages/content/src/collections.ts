import type { FrontMatter } from '@timber/generator';
import type { SiteContext } from './seo.js';
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
  /**
   * The object's language (SPEC §5 → Multilingual), present only on i18n-enabled sites.
   * Lets a listing filter to the current page's language with the existing `where`
   * filter: `collections.posts | where: 'lang', page.lang`.
   */
  lang?: string;
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
    // Language, only on i18n-enabled sites (omit rather than write `undefined`).
    if (object.lang !== undefined) entry.lang = object.lang;
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

/**
 * Expose each collection type on the `site` object as well (Tier-1) — so `site.posts`
 * resolves the same array as `collections.posts`. Timber keeps `collections.<type>` as
 * the **canonical, collision-safe** name (a user-defined type can be called anything, so
 * walling the type namespace off from the settings namespace is deliberate); this adds a
 * Jekyll-shaped alias for compatibility, **without ever clobbering a real settings key**:
 * if the settings singleton already defines `site.<type>` (e.g. a type literally named
 * `title`), that identity wins and the alias is skipped — `collections.<type>` stays the
 * unambiguous escape hatch. Also mirrors the build/preview instant onto `site.time`
 * (Jekyll's site-wide clock) when supplied. Returns a new object; the input is untouched.
 */
export function withCollectionAliases(
  site: SiteContext,
  collections: Collections,
  now?: string,
): SiteContext {
  const merged: SiteContext = { ...site };
  for (const [type, entries] of Object.entries(collections)) {
    if (!(type in merged)) merged[type] = entries; // settings identity wins over the alias
  }
  if (now !== undefined && !('time' in merged)) merged.time = now;
  return merged;
}
