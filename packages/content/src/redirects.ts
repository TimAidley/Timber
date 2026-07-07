import { urlFor } from './references.js';
import type { ContentObject, ContentTypeSchema } from './types.js';

/**
 * A minimal client-side redirect stub (SPEC §5). GitHub Pages has no server-side
 * redirects, so a renamed object's OLD url gets a static page that meta-refreshes
 * (and links) to its current url — emitted by the build from the object's `aliases`.
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
 * The old URLs an object should redirect from — one per `aliases` entry, each an old
 * slug resolved through the type's `urlPattern` (SPEC §5: rename keeps references
 * working and leaves a redirect stub at the old address). Aliases that aren't strings,
 * or that equal the object's current slug, are ignored.
 */
export function aliasUrls(object: ContentObject, schema: ContentTypeSchema): string[] {
  const raw = object.data.aliases;
  if (!Array.isArray(raw)) return [];
  const urls: string[] = [];
  for (const alias of raw) {
    if (typeof alias !== 'string' || alias === object.slug) continue;
    // Reuse urlFor with the alias standing in as the slug.
    const url = urlFor({ ...object, slug: alias }, schema);
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}
