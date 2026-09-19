import { urlFor } from './references.js';
import { isPublic } from './visibility.js';
import type { ContentModel, ContentObject, ContentTypeSchema } from './types.js';

/**
 * A minimal client-side redirect stub (SPEC §5). Static Pages hosts (GitHub, Codeberg,
 * GitLab, …) have no server-side redirects, so a renamed object's OLD url gets a static
 * page that meta-refreshes (and links) to its current url — emitted by the build from the
 * object's `aliases`. Host-neutral: meta-refresh works on any static host.
 * `<link rel="canonical">` tells crawlers the real destination.
 */
export function redirectStubHtml(toUrl: string): string {
  // `toUrl` derives from the object's slug via `urlFor` — editable, so not trusted.
  // Escape it before interpolating into HTML/attributes so a slug like `"><script>…`
  // can't turn this generated stub into a stored-XSS page.
  const safe = escapeHtml(toUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${safe}">
<link rel="canonical" href="${safe}">
<title>Redirecting…</title>
</head>
<body>
<p>This page has moved to <a href="${safe}">${safe}</a>.</p>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The old URLs an object should redirect from — one per `aliases` entry (SPEC §5:
 * rename keeps references working and leaves a redirect stub at the old address).
 * Two alias shapes exist:
 *
 *   - a bare **slug** (`fete`) — an old slug, resolved through the type's *current*
 *     `urlPattern` (a per-object rename);
 *   - an absolute **URL** (`/events/fete/`) — a literal old address, used when the
 *     pattern itself changed (a **type rename** moves every object from `/old/<slug>/`
 *     to `/new/<slug>/`, so the old slug alone can no longer name the old URL).
 *
 * Aliases that aren't strings, that equal the object's current slug, or that resolve to
 * the object's current URL are ignored (a stub must never overwrite the real page).
 */
export function aliasUrls(object: ContentObject, schema: ContentTypeSchema): string[] {
  const raw = object.data.aliases;
  if (!Array.isArray(raw)) return [];
  const current = urlFor(object, schema);
  const urls: string[] = [];
  for (const alias of raw) {
    if (typeof alias !== 'string' || alias === object.slug) continue;
    // An absolute alias is the old URL itself; a slug reuses urlFor standing in as the slug.
    const url = alias.startsWith('/')
      ? alias
      : urlFor({ ...object, slug: alias }, schema);
    if (url === current || urls.includes(url)) continue;
    urls.push(url);
  }
  return urls;
}

/** One alias of an object whose old URL is now a live page's address. */
export interface ShadowedAlias {
  /** The alias as written in front matter (a slug or an absolute URL). */
  alias: string;
  /** The URL it resolves to. */
  url: string;
  /** The public page that lives at that URL. */
  by: ContentObject;
}

/**
 * The aliases of `object` that a **live page now occupies** (SPEC §5). An alias is an
 * old address kept only so a redirect stub can be emitted there; once another public,
 * page-rendering object has that URL — a page created with a slug that was renamed
 * away, or a type re-created under a name a type rename vacated — the stub and the
 * page would fight over one `index.html`. The build lets the page win and skips the
 * stub, and the validator reports the alias so the author removes it: it's stale
 * metadata that can no longer do its job.
 *
 * Routes exactly as the build does: the settings singleton's `homepage` object lives at
 * `/`, not at its pattern URL, so it never shadows an alias at that pattern URL.
 */
export function shadowedAliases(
  object: ContentObject,
  schema: ContentTypeSchema,
  model: ContentModel,
): ShadowedAlias[] {
  const settings = model.objects.find((o) => model.schemas.get(o.type)?.page === false);
  const homepageId =
    typeof settings?.data.homepage === 'string' ? settings.data.homepage : undefined;
  const urlOf = (o: ContentObject, s: ContentTypeSchema): string =>
    homepageId && o.id === homepageId ? '/' : urlFor(o, s);

  const live = new Map<string, ContentObject>();
  for (const other of model.objects) {
    if (other === object || other.path === object.path || !isPublic(other)) continue;
    const otherSchema = model.schemas.get(other.type);
    if (!otherSchema || otherSchema.page === false) continue;
    const url = urlOf(other, otherSchema);
    if (!live.has(url)) live.set(url, other);
  }
  if (live.size === 0) return [];

  const raw = object.data.aliases;
  if (!Array.isArray(raw)) return [];
  const out: ShadowedAlias[] = [];
  for (const alias of raw) {
    if (typeof alias !== 'string' || alias === object.slug) continue;
    const url = alias.startsWith('/')
      ? alias
      : urlFor({ ...object, slug: alias }, schema);
    const by = live.get(url);
    if (by && !out.some((s) => s.url === url)) out.push({ alias, url, by });
  }
  return out;
}
