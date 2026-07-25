import type { FrontMatter } from '@timber/generator';
import type { CollectionEntry, Collections } from './collections.js';
import { pageSeo, type PageSeo, type SiteContext } from './seo.js';
import type { ContentObject, ContentTypeSchema, FieldError } from './types.js';

/**
 * Paginated listings (SPEC §13). A listing page is an **ordinary content object**
 * that declares what it paginates in its front matter:
 *
 * ```yaml
 * ---
 * title: Blog
 * paginate:
 *   collection: posts
 *   size: 10
 * ---
 * ```
 *
 * The build then emits that one object as N pages — page 1 at the object's own URL,
 * later pages under it (`/blog/`, `/blog/page/2/`, …) — each rendered through the
 * object's normal template with a {@link Paginator} in scope. Everything here is
 * **pure** (no fs/DOM/clock), so the CLI build and the browser preview compute the
 * same pages from the same model and preview ≡ build (SPEC §6).
 *
 * `paginate` is an *undeclared but tolerated* front-matter key (SPEC §5 validation),
 * like `aliases`/`created`/`public` — no schema change is needed to add a listing.
 * A **malformed** block is still a publish-blocking validation error, since it would
 * otherwise break the build (see {@link validatePaginate}).
 */

/** The front-matter key a listing page declares its pagination under. */
export const PAGINATE_KEY = 'paginate';

/** Entries per page when the `paginate` block doesn't say. */
export const DEFAULT_PAGE_SIZE = 10;

/** A listing page's resolved pagination declaration. */
export interface PaginateSpec {
  /** The collection type whose entries are paginated (e.g. `posts`). */
  collection: string;
  /** Entries per page. */
  size: number;
}

/** One page of a paginated listing, as a link — for rendering a numbered pager. */
export interface PaginatorPageLink {
  /** 1-based page number. */
  number: number;
  /** The page's site-relative URL. */
  url: string;
  /** Whether this link is the page currently being rendered. */
  current: boolean;
}

/**
 * The `{{ paginator }}` a listing page's template renders with — this page's slice of
 * the collection plus everything needed to draw a pager. Present only on a paginated
 * page; ordinary pages have no `paginator`, so a theme's listing markup is a no-op
 * there (`{% if paginator %}`).
 *
 * Alongside the native keys it carries **Jekyll's** pagination names (`posts`,
 * `per_page`, `total_pages`, `next_page_path`, …) so an imported Jekyll theme's
 * existing pagination markup renders unchanged (SPEC §2 → Tier A).
 */
export interface Paginator {
  /** This page's entries. */
  items: CollectionEntry[];
  /** 1-based number of this page. */
  page: number;
  /** How many pages the listing has in total (at least 1, even when empty). */
  totalPages: number;
  /** How many entries the whole listing has. */
  totalItems: number;
  /** Entries per page. */
  size: number;
  /** This page's own site-relative URL. */
  url: string;
  /** The first page's URL (the listing object's own URL). */
  firstUrl: string;
  /** The last page's URL. */
  lastUrl: string;
  /** The previous page's URL; absent on page 1. */
  previousUrl?: string;
  /** The next page's URL; absent on the last page. */
  nextUrl?: string;
  /** The previous page's number; absent on page 1. */
  previousPage?: number;
  /** The next page's number; absent on the last page. */
  nextPage?: number;
  /** Every page as a link, for a numbered pager. */
  pages: PaginatorPageLink[];

  /* ---- Jekyll-compatible aliases (same values, Jekyll's names) ---- */
  /** Jekyll alias of {@link items}. */
  posts: CollectionEntry[];
  /** Jekyll alias of {@link size}. */
  per_page: number;
  /** Jekyll alias of {@link totalPages}. */
  total_pages: number;
  /** Jekyll alias of {@link totalItems}. */
  total_posts: number;
  /** Jekyll alias of {@link previousPage}. */
  previous_page?: number;
  /** Jekyll alias of {@link previousUrl}. */
  previous_page_path?: string;
  /** Jekyll alias of {@link nextPage}. */
  next_page?: number;
  /** Jekyll alias of {@link nextUrl}. */
  next_page_path?: string;

  /** Keeps the paginator assignable to the generator's loose template-context bag. */
  [key: string]: unknown;
}

/** Read `paginate` as a plain mapping, or `undefined` if it isn't one. */
function paginateBlock(data: FrontMatter): Record<string, unknown> | undefined {
  const raw = data[PAGINATE_KEY];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
}

/**
 * Resolve an object's `paginate` front matter to a {@link PaginateSpec}, or `undefined`
 * when it declares none (the overwhelmingly common case) — or declares one so malformed
 * there is nothing to act on. Lenient by design: {@link validatePaginate} is what
 * *reports* a bad block, so a half-typed `paginate:` can still be saved as a draft
 * (SPEC §5 — tolerant validation, publish is the gate).
 */
export function parsePaginate(data: FrontMatter): PaginateSpec | undefined {
  const block = paginateBlock(data);
  if (!block) return undefined;
  const collection = block.collection;
  if (typeof collection !== 'string' || collection.length === 0) return undefined;
  const rawSize = block.size;
  const size =
    typeof rawSize === 'number' && Number.isInteger(rawSize) && rawSize > 0
      ? rawSize
      : DEFAULT_PAGE_SIZE;
  return { collection, size };
}

/**
 * Validate an object's `paginate` block. Returns `[]` when there is none — pagination
 * is opt-in and undeclared keys pass through (SPEC §5) — but a block that *is* present
 * and wrong is an error, because the build would otherwise emit a listing page with
 * nothing on it (or fail). Like every other validation error this blocks **publish**,
 * not saving.
 */
export function validatePaginate(
  object: ContentObject,
  schemas: Map<string, ContentTypeSchema>,
): FieldError[] {
  if (object.data[PAGINATE_KEY] === undefined) return [];

  const field = PAGINATE_KEY;
  const block = paginateBlock(object.data);
  if (!block) {
    return [
      {
        field,
        message: `paginate must be a mapping with a "collection" (and optional "size"), e.g. { collection: posts, size: 10 }`,
      },
    ];
  }

  const errors: FieldError[] = [];

  const collection = block.collection;
  if (typeof collection !== 'string' || collection.length === 0) {
    errors.push({
      field,
      message: 'paginate.collection is required and must be a type name',
    });
  } else {
    const target = schemas.get(collection);
    if (!target) {
      errors.push({
        field,
        message: `paginate.collection "${collection}" is not a known content type`,
      });
    } else if (target.kind !== 'collection') {
      errors.push({
        field,
        message: `paginate.collection "${collection}" is a singleton — only collection types can be paginated`,
      });
    }
  }

  const size = block.size;
  if (
    size !== undefined &&
    (typeof size !== 'number' || !Number.isInteger(size) || size < 1)
  ) {
    errors.push({ field, message: 'paginate.size must be a whole number of 1 or more' });
  }

  // A type that renders no page (the settings singleton, `page: false`) has no URL to
  // paginate under, so a `paginate` block there can never do anything.
  if (schemas.get(object.type)?.page === false) {
    errors.push({
      field,
      message: `type "${object.type}" renders no pages, so it cannot paginate a collection`,
    });
  }

  return errors;
}

/**
 * The URL of page `n` of a listing whose first page lives at `baseUrl`: page 1 keeps the
 * listing object's own URL, later pages nest under it as `page/<n>/` (SPEC §13 — the
 * Jekyll/GitHub-Pages convention Timber sits in, and a shape that can never collide with
 * a `<listing>/<slug>/` child). Composes with language prefixes and base paths for free,
 * since it only ever appends to whatever URL routing produced (`/fr/blog/page/2/`).
 */
export function pageUrl(baseUrl: string, page: number): string {
  if (page <= 1) return baseUrl;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}page/${page}/`;
}

/**
 * Slice a listing's entries into one {@link Paginator} per output page.
 *
 * Always returns at least one page, so a listing with nothing in it yet still renders
 * (an empty blog index is a normal state, not a build failure). Pure — the caller
 * supplies the already-ordered entries and the listing's URL, so the CLI build and the
 * browser preview produce identical pages.
 */
export function paginateEntries(
  entries: readonly CollectionEntry[],
  size: number,
  baseUrl: string,
): Paginator[] {
  const perPage = Math.max(1, Math.floor(size));
  const totalPages = Math.max(1, Math.ceil(entries.length / perPage));
  const urls: string[] = [];
  for (let n = 1; n <= totalPages; n += 1) urls.push(pageUrl(baseUrl, n));

  const out: Paginator[] = [];
  for (let n = 1; n <= totalPages; n += 1) {
    const items = entries.slice((n - 1) * perPage, n * perPage) as CollectionEntry[];
    const paginator: Paginator = {
      items,
      page: n,
      totalPages,
      totalItems: entries.length,
      size: perPage,
      url: urls[n - 1]!,
      firstUrl: urls[0]!,
      lastUrl: urls[totalPages - 1]!,
      pages: urls.map((url, index) => ({
        number: index + 1,
        url,
        current: index + 1 === n,
      })),
      // Jekyll's names for the same values, so an imported theme's pager works (SPEC §2).
      posts: items,
      per_page: perPage,
      total_pages: totalPages,
      total_posts: entries.length,
    };
    if (n > 1) {
      paginator.previousPage = n - 1;
      paginator.previousUrl = urls[n - 2]!;
      paginator.previous_page = n - 1;
      paginator.previous_page_path = urls[n - 2]!;
    }
    if (n < totalPages) {
      paginator.nextPage = n + 1;
      paginator.nextUrl = urls[n]!;
      paginator.next_page = n + 1;
      paginator.next_page_path = urls[n]!;
    }
    out.push(paginator);
  }
  return out;
}

/**
 * The pages a content object renders as: `undefined` for an ordinary page (render it
 * once, exactly as before pagination existed), or one {@link Paginator} per output page
 * for a listing that declares `paginate` front matter.
 *
 * This is the **single entry point both callers use** — the CLI build and the browser
 * preview — so a listing paginates identically in preview and production (SPEC §6).
 * `url` is the object's own resolved URL, passed in because routing (homepage-at-root,
 * language prefixes) belongs to the caller.
 *
 * Two filters are applied to the collection before slicing:
 * - **the listing itself is excluded**, so a page that paginates its own type doesn't
 *   list itself;
 * - on an i18n site (SPEC §5 → Multilingual) a listing with a `lang` keeps only entries
 *   of that language — plus any language-less entry, which belongs to every language.
 */
export function paginateObject(
  object: ContentObject,
  collections: Collections,
  url: string,
): Paginator[] | undefined {
  const spec = parsePaginate(object.data);
  if (!spec) return undefined;
  const all = collections[spec.collection] ?? [];
  const entries = all.filter((entry) => {
    if (object.id !== undefined && entry.id === object.id) return false;
    if (
      object.lang !== undefined &&
      entry.lang !== undefined &&
      entry.lang !== object.lang
    )
      return false;
    return true;
  });
  return paginateEntries(entries, spec.size, url);
}

/**
 * Per-page SEO for one page of a paginated listing (SPEC §13): the object's normal
 * {@link pageSeo}, but with **this** page's canonical URL, a `Page N of M` title suffix
 * on pages 2+ (so paginated pages aren't duplicate titles), and absolute `prev`/`next`
 * for `<link rel="prev"|"next">`.
 */
export function paginatedSeo(
  object: ContentObject,
  schema: ContentTypeSchema,
  site: SiteContext,
  paginator: Paginator,
): PageSeo {
  const seo = pageSeo(object, schema, site, {
    url: paginator.url,
    ...(paginator.page > 1
      ? { titleSuffix: `Page ${paginator.page} of ${paginator.totalPages}` }
      : {}),
  });
  const baseUrl = typeof site.baseUrl === 'string' ? site.baseUrl : '';
  const abs = (path: string): string => (baseUrl ? `${baseUrl}${path}` : path);
  if (paginator.previousUrl !== undefined) seo.prev = abs(paginator.previousUrl);
  if (paginator.nextUrl !== undefined) seo.next = abs(paginator.nextUrl);
  return seo;
}
