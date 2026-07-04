import { urlFor } from './references.js';
import type { ContentObject, ContentTypeSchema } from './types.js';

/**
 * A minimal client-side redirect stub (SPEC §5). GitHub Pages has no server-side
 * redirects, so a renamed object's OLD url gets a static page that meta-refreshes
 * (and links) to its current url — emitted by the build from the object's `aliases`.
 * `<link rel="canonical">` tells crawlers the real destination.
 */
export function redirectStubHtml(toUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${toUrl}">
<link rel="canonical" href="${toUrl}">
<title>Redirecting…</title>
</head>
<body>
<p>This page has moved to <a href="${toUrl}">${toUrl}</a>.</p>
</body>
</html>
`;
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
