import { urlFor } from './references.js';
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
  [key: string]: unknown;
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

/** Make an image reference absolute against the site base URL (best-effort). */
function absolute(baseUrl: string | undefined, ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (!baseUrl) return ref;
  return `${baseUrl}/${ref.replace(/^\/+/, '')}`;
}

/** The first `image`-kind field on the object that has a value (for the OG image). */
function firstImage(object: ContentObject, schema: ContentTypeSchema): string | undefined {
  for (const [name, field] of Object.entries(schema.fields)) {
    if (field.type === 'image') {
      const value = str(object.data[name]);
      if (value) return value;
    }
  }
  return undefined;
}

/**
 * Derive an object's SEO metadata (SPEC §13) — computed in the generator so templates
 * stay dumb. Title/description fall back through front matter → site defaults; the
 * canonical URL is `site.baseUrl` + the object's URL; the OG image is the first image
 * field, absolutized.
 */
export function pageSeo(object: ContentObject, schema: ContentTypeSchema, site: SiteContext): PageSeo {
  const data = object.data;
  const siteTitle = str(site.title);
  const pageTitle = str(data.seoTitle) ?? str(data.title) ?? object.slug;
  const title = siteTitle && pageTitle !== siteTitle ? `${pageTitle} · ${siteTitle}` : pageTitle;

  const description = str(data.description) ?? str(data.excerpt) ?? str(site.description) ?? '';
  const baseUrl = str(site.baseUrl);
  const path = urlFor(object, schema);
  const canonical = baseUrl ? `${baseUrl}${path}` : path;

  const image = firstImage(object, schema);
  const ogImage = image ? absolute(baseUrl, image) : undefined;

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
