import { describe, it, expect } from 'vitest';
import { assembleCollections, urlFor } from '../src/index.js';
import type {
  ContentModel,
  ContentObject,
  ContentTypeSchema,
} from '../src/types.js';

/** Minimal collection-type schema with the given fields. */
function schema(name: string, fields: ContentTypeSchema['fields'] = {}): ContentTypeSchema {
  return { name, kind: 'collection', fields };
}

/** A public-by-default object of `type` with `slug` and front-matter `data`. */
function obj(
  type: string,
  slug: string,
  data: Record<string, unknown> = {},
  isPublic = true,
): ContentObject {
  return {
    type,
    kind: 'collection',
    id: `${type}-${slug}`,
    slug,
    path: `content/${type}/${slug}/index.md`,
    data,
    body: '',
    public: isPublic,
  };
}

function model(
  schemas: ContentTypeSchema[],
  objects: ContentObject[],
): ContentModel {
  return {
    schemas: new Map(schemas.map((s) => [s.name, s])),
    objects,
    byId: new Map(objects.map((o) => [o.id!, o])),
    errors: [],
  };
}

describe('assembleCollections', () => {
  it('groups public objects by collection type with computed url/slug/id', () => {
    const m = model(
      [schema('posts', { title: { type: 'text' } })],
      [obj('posts', 'hello', { title: 'Hello' })],
    );
    const collections = assembleCollections(m, urlFor);

    expect(collections.posts).toHaveLength(1);
    expect(collections.posts[0]).toMatchObject({
      title: 'Hello',
      slug: 'hello',
      id: 'posts-hello',
      url: '/posts/hello/',
    });
  });

  it('sorts by the first date/datetime field, most recent first', () => {
    const m = model(
      [schema('posts', { title: { type: 'text' }, date: { type: 'date' } })],
      [
        obj('posts', 'old', { title: 'Old', date: '2024-01-01' }),
        obj('posts', 'new', { title: 'New', date: '2026-06-30' }),
        obj('posts', 'mid', { title: 'Mid', date: '2025-03-15' }),
      ],
    );
    const collections = assembleCollections(m, urlFor);
    expect(collections.posts.map((p) => p.slug)).toEqual(['new', 'mid', 'old']);
  });

  it('sorts objects missing the date field last, tiebreaking by slug', () => {
    const m = model(
      [schema('posts', { date: { type: 'date' } })],
      [
        obj('posts', 'zeta'), // no date
        obj('posts', 'alpha'), // no date
        obj('posts', 'dated', { date: '2025-01-01' }),
      ],
    );
    const collections = assembleCollections(m, urlFor);
    expect(collections.posts.map((p) => p.slug)).toEqual(['dated', 'alpha', 'zeta']);
  });

  it('falls back to slug order for types with no date field', () => {
    const m = model(
      [schema('posts', { title: { type: 'text' } })],
      [obj('posts', 'b'), obj('posts', 'a'), obj('posts', 'c')],
    );
    const collections = assembleCollections(m, urlFor);
    expect(collections.posts.map((p) => p.slug)).toEqual(['a', 'b', 'c']);
  });

  it('excludes drafts', () => {
    const m = model(
      [schema('posts')],
      [obj('posts', 'live'), obj('posts', 'draft', {}, false)],
    );
    const collections = assembleCollections(m, urlFor);
    expect(collections.posts.map((p) => p.slug)).toEqual(['live']);
  });

  it('excludes singleton types (they reach templates via {{ site }})', () => {
    const settings: ContentTypeSchema = {
      name: 'settings',
      kind: 'singleton',
      page: false,
      fields: {},
    };
    const settingsObj: ContentObject = {
      type: 'settings',
      kind: 'singleton',
      slug: 'settings',
      path: 'content/settings/index.md',
      data: { title: 'Site' },
      body: '',
      public: true,
    };
    const m = model([schema('posts'), settings], [obj('posts', 'p'), settingsObj]);
    const collections = assembleCollections(m, urlFor);
    expect(Object.keys(collections)).toEqual(['posts']);
  });

  it('computes url through the injected resolver (homepage-at-root aware)', () => {
    const m = model([schema('pages')], [obj('pages', 'home'), obj('pages', 'about')]);
    const homepageId = 'pages-home';
    const collections = assembleCollections(m, (o, s) =>
      o.id === homepageId ? '/' : urlFor(o, s),
    );
    const bySlug = Object.fromEntries(collections.pages.map((p) => [p.slug, p.url]));
    expect(bySlug.home).toBe('/');
    expect(bySlug.about).toBe('/pages/about/');
  });
});
