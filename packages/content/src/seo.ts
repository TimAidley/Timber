import { urlFor } from './references.js';
import { themeStyle } from './theme.js';
import type { ContentObject, ContentTypeSchema } from './types.js';

/** Site-wide context exposed to templates as `{{ site }}` (SPEC §13 global settings). */
export type SiteContext = Record<string, unknown>;

/**
 * Per-page derived SEO exposed to templates as `{{ seo }}` (SPEC §13 baked-in SEO).
 * The index signature keeps it a plain template-context bag (assignable to the
 * generator's `Record<string, unknown>` context) while still typing the known keys.
 */
export interface PageSeo {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogType: string;
  ogImage?: string;
  /** Absolute URL of the previous page of a paginated listing (SPEC §13), if any. */
  prev?: string;
  /** Absolute URL of the next page of a paginated listing (SPEC §13), if any. */
  next?: string;
  [key: string]: unknown;
}

/** Caller-supplied adjustments to an object's derived SEO (see {@link pageSeo}). */
export interface PageSeoOptions {
  /**
   * The page's resolved URL, used for the canonical. Pass the URL the caller's routing
   * produced — homepage-at-root (`/`), a language prefix, or one page of a paginated
   * listing (`/blog/page/2/`) — so the canonical always matches where the page is
   * actually written. Omit to fall back to the object's own {@link urlFor}.
   */
  url?: string;
  /**
   * Appended to the page title *before* the site-title suffix, giving
   * `Blog · Page 2 of 5 · My Site`. Used by paginated listings so pages 2+ don't all
   * share one title.
   */
  titleSuffix?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Trim a trailing slash so `${baseUrl}${path}` never doubles up. */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Build the `{{ site }}` context from the global-settings singleton's front matter
 * (SPEC §13). Exposes every settings key (title, description, social links, …) to
 * templates; `baseUrl` is normalized (no trailing slash). Empty object if there's
 * no settings singleton — the site still builds, just without site-wide identity.
 */
export function siteContext(settings?: ContentObject): SiteContext {
  const data = settings?.data ?? {};
  const site: SiteContext = { ...data };
  const baseUrl = str(data.baseUrl);
  if (baseUrl) site.baseUrl = trimTrailingSlash(baseUrl);
  // The path portion of the base URL, so in-page links work when the site is served from
  // a subpath — any project-Pages-style host (GitHub `you.github.io/<repo>`, Codeberg
  // `you.codeberg.page/<repo>`, GitLab `you.gitlab.io/<repo>`) at `/<repo>/` (SPEC §3, §13).
  // `/repo` for those; `''` for a root site / custom domain / no baseUrl. Host-neutral: it's
  // derived from the configured `baseUrl`. Templates prefix root-absolute links: `{{ site.basePath }}/...`.
  site.basePath = basePathOf(baseUrl);
  // Settings-driven theme overrides (SPEC §13): a validated `:root{…}` block the default
  // template emits into a `<style>` after theme.css. Empty string when no knob is set.
  site.themeStyle = themeStyle(data);
  return site;
}

/** The (trailing-slash-trimmed) path of a base URL: `/repo`, or `''` for root/none. */
function basePathOf(baseUrl: string | undefined): string {
  if (!baseUrl) return '';
  try {
    const path = new URL(baseUrl).pathname.replace(/\/+$/, '');
    return path === '' ? '' : path;
  } catch {
    return '';
  }
}

/**
 * Make an image reference absolute for `og:image` (which must be a full URL).
 *
 * An `image` field stores the path **relative to the object's bundle**
 * (`images/photo.webp`) — the build copies a bundle's files flat next to the page it
 * renders, so the reference resolves against the **page's** URL, not the site root.
 * A root-relative reference (`/assets/logo.png`) is site-root-based already, and an
 * absolute URL belongs to somebody else and passes through.
 */
function absolute(baseUrl: string | undefined, pageUrl: string, ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  // A throwaway origin resolves any `./` or `../`; only the path part is kept.
  const path = ref.startsWith('/')
    ? ref
    : new URL(ref, `https://timber.invalid${pageUrl}`).pathname;
  if (!baseUrl) return path;
  return `${baseUrl}${path}`;
}

/**
 * The first `image`-kind field on the object that has a value (for the OG image),
 * as a bundle-relative reference. Older content holds the object's **repo path**
 * (`content/events/fete/images/p.webp`) — what the editor used to write — so that
 * prefix is stripped, leaving both forms in the one coordinate system.
 */
function firstImage(
  object: ContentObject,
  schema: ContentTypeSchema,
): string | undefined {
  const bundlePrefix = `${object.path.replace(/\/[^/]*$/, '')}/`;
  for (const [name, field] of Object.entries(schema.fields)) {
    if (field.type === 'image') {
      const value = str(object.data[name]);
      if (value)
        return value.startsWith(bundlePrefix) ? value.slice(bundlePrefix.length) : value;
    }
  }
  return undefined;
}

/**
 * Derive an object's SEO metadata (SPEC §13) — computed in the generator so templates
 * stay dumb. Title/description fall back through front matter → site defaults; the
 * canonical URL is `site.baseUrl` + the object's URL; the OG image is the first image
 * field, absolutized against that page URL.
 */
export function pageSeo(
  object: ContentObject,
  schema: ContentTypeSchema,
  site: SiteContext,
  options?: PageSeoOptions,
): PageSeo {
  const data = object.data;
  const siteTitle = str(site.title);
  const ownTitle = str(data.seoTitle) ?? str(data.title) ?? object.slug;
  const pageTitle = options?.titleSuffix
    ? `${ownTitle} · ${options.titleSuffix}`
    : ownTitle;
  const title =
    siteTitle && pageTitle !== siteTitle ? `${pageTitle} · ${siteTitle}` : pageTitle;

  const description =
    str(data.description) ?? str(data.excerpt) ?? str(site.description) ?? '';
  const baseUrl = str(site.baseUrl);
  const path = options?.url ?? urlFor(object, schema);
  const canonical = baseUrl ? `${baseUrl}${path}` : path;

  const image = firstImage(object, schema);
  const ogImage = image ? absolute(baseUrl, path, image) : undefined;

  return {
    title,
    description,
    canonical,
    ogTitle: pageTitle,
    ogDescription: description,
    ogType: 'website',
    ...(ogImage ? { ogImage } : {}),
  };
}

/** One `<link rel="alternate" hreflang="…">` entry (SPEC §5 → Multilingual). */
export interface HreflangAlternate {
  /** BCP-47 code, or the literal `x-default`. */
  lang: string;
  /** Absolute URL when a `baseUrl` is known, else the site-relative URL. */
  href: string;
}

/**
 * Build the `hreflang` alternates for a page from its sibling {@link Translation}s
 * (SPEC §5 → Multilingual → SEO): one entry per language plus an `x-default` pointing at
 * the default-language variant. Hrefs are **absolute** against `site.baseUrl` when known
 * (Google recommends absolute hreflang), else left site-relative. Returns `[]` for a page
 * with fewer than two variants — a lone page needs no alternates — so single-language
 * sites emit nothing.
 */
export function hreflangAlternates(
  translations: ReadonlyArray<{ lang: string; url: string }>,
  site: SiteContext,
  defaultLanguage?: string,
): HreflangAlternate[] {
  if (translations.length < 2) return [];
  const baseUrl = str(site.baseUrl);
  const abs = (url: string): string => (baseUrl ? `${baseUrl}${url}` : url);
  const out: HreflangAlternate[] = translations.map((t) => ({
    lang: t.lang,
    href: abs(t.url),
  }));
  const fallback = translations[0]!;
  const def =
    (defaultLanguage && translations.find((t) => t.lang === defaultLanguage)) || fallback;
  out.push({ lang: 'x-default', href: abs(def.url) });
  return out;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A `sitemap.xml` from a list of canonical URLs (SPEC §13). */
export function buildSitemap(urls: string[]): string {
  const entries = urls.map((u) => `  <url><loc>${escapeXml(u)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

/** A `robots.txt` allowing all, pointing at the sitemap when a base URL is known (SPEC §13). */
export function buildRobots(site: SiteContext): string {
  const baseUrl = str(site.baseUrl);
  const sitemap = baseUrl ? `Sitemap: ${baseUrl}/sitemap.xml\n` : '';
  return `User-agent: *\nAllow: /\n${sitemap}`;
}
