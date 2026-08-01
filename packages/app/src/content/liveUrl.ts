import {
  siteContext,
  urlFor,
  type ContentModel,
  type ContentObject,
  type ContentTypeSchema,
} from '@timber/content';

/**
 * Links into the **deployed** site (SPEC §8) — the real website, as distinct from the
 * in-editor preview: the banner's site-wide link and the per-page "View live" link.
 *
 * Both are built from the same two pieces the build itself uses — the settings
 * singleton's `baseUrl` and the object's routed path — so a link can never disagree with
 * where the generator actually writes the page.
 */

/**
 * The site's own root URL, or `undefined` when there's nothing honest to link to.
 *
 * `baseUrl` comes from committed content, so it's validated rather than trusted: it must
 * parse as an absolute `http(s)` URL before it can become an anchor `href` (a
 * `javascript:` "base URL" must never be linked).
 */
export function siteHomeUrl(model: ContentModel): string | undefined {
  const base = validBaseUrl(model);
  return base ? `${base}/` : undefined;
}

/**
 * The URL an object occupies on the deployed site: `baseUrl` plus the page's routed
 * path — homepage-at-root when `site.homepage` names this object, otherwise `urlFor`'s
 * `/{type}/{slug}/` (language-prefixed on an i18n site).
 *
 * `undefined` whenever there's no honest answer rather than a guess: a non-page type
 * (`page: false`) never gets a page, and a site with no usable `baseUrl` has no origin.
 */
export function livePageUrl(
  model: ContentModel,
  object: ContentObject,
  schema: ContentTypeSchema,
): string | undefined {
  if (schema.page === false) return undefined;
  const base = validBaseUrl(model);
  if (!base) return undefined;

  const site = siteContext(siteSettings(model));
  const homepageId = typeof site.homepage === 'string' ? site.homepage : undefined;
  const path = homepageId && object.id === homepageId ? '/' : urlFor(object, schema);
  // `siteContext` already trimmed any trailing slash, so `${base}${path}` never doubles up.
  return `${base}${path}`;
}

/** The configured `baseUrl` — trailing slash trimmed — if it's a linkable http(s) URL. */
function validBaseUrl(model: ContentModel): string | undefined {
  const site = siteContext(siteSettings(model));
  const baseUrl = typeof site.baseUrl === 'string' ? site.baseUrl : '';
  if (!baseUrl) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return undefined; // not an absolute URL — nothing safe to link to
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return baseUrl;
}

/** The site's global-settings singleton: the one type declared `page: false` (SPEC §13). */
function siteSettings(model: ContentModel): ContentObject | undefined {
  return model.objects.find((o) => model.schemas.get(o.type)?.page === false);
}
