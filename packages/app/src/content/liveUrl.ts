import {
  siteContext,
  urlFor,
  type ContentModel,
  type ContentObject,
  type ContentTypeSchema,
} from '@timber/content';

/**
 * The URL an object occupies on the **deployed** site, so the editor can offer a
 * "View live" link straight to the real page (SPEC §8).
 *
 * It composes the same two pieces the build does — the settings singleton's `baseUrl`
 * and the object's routed path — so the link matches what the generator writes:
 * homepage-at-root when `site.homepage` names this object, otherwise `urlFor`'s
 * `/{type}/{slug}/` (language-prefixed on an i18n site).
 *
 * Returns `undefined` whenever there is no honest live URL to offer, rather than
 * guessing one: a non-page type (`page: false`) never gets a page, and a site with no
 * configured `baseUrl` has no origin to point at. `baseUrl` comes from committed
 * content, so it's also confined to `http(s)` — a `javascript:` "base URL" must never
 * become an anchor `href`.
 */
export function livePageUrl(
  model: ContentModel,
  object: ContentObject,
  schema: ContentTypeSchema,
): string | undefined {
  if (schema.page === false) return undefined;

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

  const homepageId = typeof site.homepage === 'string' ? site.homepage : undefined;
  const path = homepageId && object.id === homepageId ? '/' : urlFor(object, schema);
  // `siteContext` already trimmed any trailing slash, so `${baseUrl}${path}` never doubles up.
  return `${baseUrl}${path}`;
}

/** The site's global-settings singleton: the one type declared `page: false` (SPEC §13). */
function siteSettings(model: ContentModel): ContentObject | undefined {
  return model.objects.find((o) => model.schemas.get(o.type)?.page === false);
}
