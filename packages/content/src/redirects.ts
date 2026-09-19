import { urlFor } from './references.js';
import type { ContentObject, ContentTypeSchema } from './types.js';

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
    const url = alias.startsWith('/') ? alias : urlFor({ ...object, slug: alias }, schema);
    if (url === current || urls.includes(url)) continue;
    urls.push(url);
  }
  return urls;
}
