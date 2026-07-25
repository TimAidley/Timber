import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  assembleCollections,
  pageUrl,
  paginateEntries,
  paginateObject,
  paginatedSeo,
  parsePaginate,
  urlFor,
  validatePaginate,
  Validator,
} from '../src/index.js';
import type {
  CollectionEntry,
  ContentModel,
  ContentObject,
  ContentTypeSchema,
} from '../src/index.js';

function schema(
  name: string,
  kind: ContentTypeSchema['kind'] = 'collection',
  extra: Partial<ContentTypeSchema> = {},
): ContentTypeSchema {
  return { name, kind, fields: { title: { type: 'text' } }, ...extra };
}

function obj(
  type: string,
  slug: string,
  data: Record<string, unknown> = {},
  extra: Partial<ContentObject> = {},
): ContentObject {
  return {
    type,
    kind: 'collection',
    id: `${type}-${slug}`,
    slug,
    path: `content/${type}/${slug}/index.md`,
    data,
    body: '',
    public: true,
    ...extra,
  };
}

function model(schemas: ContentTypeSchema[], objects: ContentObject[]): ContentModel {
  return {
    schemas: new Map(schemas.map((s) => [s.name, s])),
    objects,
    byId: new Map(objects.map((o) => [o.id!, o])),
    byTranslation: new Map(),
    errors: [],
  };
}

/** `count` entries named post-1…post-N, newest first (as collections are assembled). */
function entries(count: number): CollectionEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Post ${i + 1}`,
    slug: `post-${i + 1}`,
    url: `/posts/post-${i + 1}/`,
    id: `posts-post-${i + 1}`,
  }));
}

describe('parsePaginate', () => {
  it('reads collection + size from the front-matter block', () => {
    expect(parsePaginate({ paginate: { collection: 'posts', size: 5 } })).toEqual({
      collection: 'posts',
      size: 5,
    });
  });

  it('defaults the page size when only a collection is given', () => {
    expect(parsePaginate({ paginate: { collection: 'posts' } })).toEqual({
      collection: 'posts',
      size: DEFAULT_PAGE_SIZE,
    });
  });

  it('is undefined for an ordinary page (the common case)', () => {
    expect(parsePaginate({ title: 'About' })).toBeUndefined();
  });

  it('is lenient about a malformed block — validation reports it, saving still works', () => {
    expect(parsePaginate({ paginate: 'posts' })).toBeUndefined();
    expect(parsePaginate({ paginate: {} })).toBeUndefined();
    expect(parsePaginate({ paginate: { collection: 'posts', size: 0 } })).toEqual({
      collection: 'posts',
      size: DEFAULT_PAGE_SIZE,
    });
  });
});

describe('validatePaginate', () => {
  const schemas = new Map([
    ['pages', schema('pages')],
    ['posts', schema('posts')],
    ['settings', schema('settings', 'singleton', { page: false })],
  ]);

  it('passes an object with no paginate block', () => {
    expect(validatePaginate(obj('pages', 'about'), schemas)).toEqual([]);
  });

  it('passes a well-formed block', () => {
    const page = obj('pages', 'blog', { paginate: { collection: 'posts', size: 10 } });
    expect(validatePaginate(page, schemas)).toEqual([]);
  });

  it('rejects a block that is not a mapping', () => {
    const page = obj('pages', 'blog', { paginate: 'posts' });
    expect(validatePaginate(page, schemas)[0]?.field).toBe('paginate');
  });

  it('rejects an unknown or non-collection target type', () => {
    const unknown = obj('pages', 'blog', { paginate: { collection: 'nope' } });
    expect(validatePaginate(unknown, schemas)[0]?.message).toContain(
      'not a known content type',
    );

    const singleton = obj('pages', 'blog', { paginate: { collection: 'settings' } });
    expect(validatePaginate(singleton, schemas)[0]?.message).toContain('is a singleton');
  });

  it('rejects a non-positive-integer size', () => {
    for (const size of [0, -3, 2.5, '10']) {
      const page = obj('pages', 'blog', { paginate: { collection: 'posts', size } });
      expect(
        validatePaginate(page, schemas).some((e) => e.message.includes('size')),
      ).toBe(true);
    }
  });

  it('rejects pagination on a type that renders no pages', () => {
    const settings = obj('settings', 'settings', { paginate: { collection: 'posts' } });
    expect(validatePaginate(settings, schemas)[0]?.message).toContain('renders no pages');
  });

  it('blocks publish through the shared Validator (SPEC §5 — the build gate agrees)', () => {
    const page = obj('pages', 'blog', {
      title: 'Blog',
      paginate: { collection: 'nope' },
    });
    const m = model([schema('pages'), schema('posts')], [page]);
    const result = new Validator(m.schemas).validateObject(page, m);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.field).toBe('paginate');
  });
});

describe('pageUrl', () => {
  it('keeps page 1 at the listing URL and nests the rest under it', () => {
    expect(pageUrl('/blog/', 1)).toBe('/blog/');
    expect(pageUrl('/blog/', 2)).toBe('/blog/page/2/');
    expect(pageUrl('/blog/', 11)).toBe('/blog/page/11/');
  });

  it('handles the site root and a slash-less pattern', () => {
    expect(pageUrl('/', 2)).toBe('/page/2/');
    expect(pageUrl('/blog', 2)).toBe('/blog/page/2/');
  });

  it('composes with a language prefix', () => {
    expect(pageUrl('/fr/blog/', 3)).toBe('/fr/blog/page/3/');
  });
});

describe('paginateEntries', () => {
  it('slices entries into pages with prev/next links', () => {
    const pages = paginateEntries(entries(5), 2, '/blog/');
    expect(pages).toHaveLength(3);

    expect(pages[0]).toMatchObject({
      page: 1,
      totalPages: 3,
      totalItems: 5,
      size: 2,
      url: '/blog/',
      firstUrl: '/blog/',
      lastUrl: '/blog/page/3/',
      nextUrl: '/blog/page/2/',
      nextPage: 2,
    });
    expect(pages[0]!.previousUrl).toBeUndefined();
    expect(pages[0]!.items.map((e) => e.slug)).toEqual(['post-1', 'post-2']);

    expect(pages[2]).toMatchObject({
      page: 3,
      url: '/blog/page/3/',
      previousUrl: '/blog/page/2/',
      previousPage: 2,
    });
    expect(pages[2]!.nextUrl).toBeUndefined();
    expect(pages[2]!.items.map((e) => e.slug)).toEqual(['post-5']);
  });

  it('marks the current page in the numbered page list', () => {
    const pages = paginateEntries(entries(5), 2, '/blog/');
    expect(pages[1]!.pages).toEqual([
      { number: 1, url: '/blog/', current: false },
      { number: 2, url: '/blog/page/2/', current: true },
      { number: 3, url: '/blog/page/3/', current: false },
    ]);
  });

  it('still renders one page when the collection is empty', () => {
    const pages = paginateEntries([], 10, '/blog/');
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ page: 1, totalPages: 1, totalItems: 0, items: [] });
  });

  it('exposes Jekyll-compatible aliases for the same values (SPEC §2 → Tier A)', () => {
    const pages = paginateEntries(entries(5), 2, '/blog/');
    expect(pages[1]).toMatchObject({
      posts: pages[1]!.items,
      per_page: 2,
      total_pages: 3,
      total_posts: 5,
      previous_page: 1,
      previous_page_path: '/blog/',
      next_page: 3,
      next_page_path: '/blog/page/3/',
    });
  });
});

describe('paginateObject', () => {
  const posts = [schema('posts', 'collection', { fields: { title: { type: 'text' } } })];

  it('is undefined for a page with no paginate block', () => {
    const page = obj('pages', 'about', { title: 'About' });
    const m = model([schema('pages'), ...posts], [page]);
    expect(
      paginateObject(page, assembleCollections(m, urlFor), '/pages/about/'),
    ).toBeUndefined();
  });

  it('paginates the named collection in its assembled order', () => {
    const page = obj('pages', 'blog', {
      title: 'Blog',
      paginate: { collection: 'posts', size: 2 },
    });
    const m = model(
      [
        schema('pages'),
        schema('posts', 'collection', { fields: { date: { type: 'date' } } }),
      ],
      [
        page,
        obj('posts', 'old', { title: 'Old', date: '2024-01-01' }),
        obj('posts', 'new', { title: 'New', date: '2026-01-01' }),
        obj('posts', 'mid', { title: 'Mid', date: '2025-01-01' }),
      ],
    );
    const pages = paginateObject(page, assembleCollections(m, urlFor), '/pages/blog/')!;
    expect(pages).toHaveLength(2);
    // Collections sort most-recent-first, so the newest two land on page 1.
    expect(pages[0]!.items.map((e) => e.title)).toEqual(['New', 'Mid']);
    expect(pages[1]!.items.map((e) => e.title)).toEqual(['Old']);
  });

  it('excludes drafts, because collections already do', () => {
    const page = obj('pages', 'blog', { paginate: { collection: 'posts' } });
    const m = model(
      [schema('pages'), ...posts],
      [page, obj('posts', 'live'), obj('posts', 'wip', {}, { public: false })],
    );
    const pages = paginateObject(page, assembleCollections(m, urlFor), '/pages/blog/')!;
    expect(pages[0]!.items.map((e) => e.slug)).toEqual(['live']);
  });

  it('never lists the listing page itself', () => {
    const page = obj('pages', 'index', {
      title: 'All pages',
      paginate: { collection: 'pages' },
    });
    const m = model([schema('pages')], [page, obj('pages', 'about')]);
    const pages = paginateObject(page, assembleCollections(m, urlFor), '/pages/index/')!;
    expect(pages[0]!.items.map((e) => e.slug)).toEqual(['about']);
  });

  it('keeps only its own language on an i18n site (language-less entries included)', () => {
    const page = obj(
      'pages',
      'blog',
      { paginate: { collection: 'posts' } },
      { lang: 'fr' },
    );
    const m = model(
      [schema('pages'), ...posts],
      [
        page,
        obj('posts', 'bonjour', {}, { lang: 'fr' }),
        obj('posts', 'hello', {}, { lang: 'en' }),
        obj('posts', 'neutral'),
      ],
    );
    const pages = paginateObject(
      page,
      assembleCollections(m, urlFor),
      '/fr/pages/blog/',
    )!;
    expect(pages[0]!.items.map((e) => e.slug).sort()).toEqual(['bonjour', 'neutral']);
    expect(pages[0]!.url).toBe('/fr/pages/blog/');
  });
});

describe('paginatedSeo', () => {
  const site = { title: 'My Site', baseUrl: 'https://example.com' };
  const pages = schema('pages');
  const listing = obj('pages', 'blog', {
    title: 'Blog',
    paginate: { collection: 'posts', size: 2 },
  });

  it('gives page 1 the listing title and its own canonical, with no prev', () => {
    const [first] = paginateEntries(entries(5), 2, '/blog/');
    const seo = paginatedSeo(listing, pages, site, first!);
    expect(seo.title).toBe('Blog · My Site');
    expect(seo.canonical).toBe('https://example.com/blog/');
    expect(seo.prev).toBeUndefined();
    expect(seo.next).toBe('https://example.com/blog/page/2/');
  });

  it('suffixes later pages so they are not duplicate titles, with absolute prev/next', () => {
    const paginator = paginateEntries(entries(5), 2, '/blog/')[1]!;
    const seo = paginatedSeo(listing, pages, site, paginator);
    expect(seo.title).toBe('Blog · Page 2 of 3 · My Site');
    expect(seo.ogTitle).toBe('Blog · Page 2 of 3');
    expect(seo.canonical).toBe('https://example.com/blog/page/2/');
    expect(seo.prev).toBe('https://example.com/blog/');
    expect(seo.next).toBe('https://example.com/blog/page/3/');
  });

  it('leaves prev/next site-relative when the site has no baseUrl', () => {
    const paginator = paginateEntries(entries(5), 2, '/blog/')[1]!;
    const seo = paginatedSeo(listing, pages, { title: 'My Site' }, paginator);
    expect(seo.canonical).toBe('/blog/page/2/');
    expect(seo.prev).toBe('/blog/');
  });
});
