import type { Liquid } from 'liquidjs';

/**
 * Register the Eleventy ecosystem's genuinely built-in Liquid filters on a LiquidJS engine —
 * the short list Eleventy ships (`url`, `slugify`/`slug`, `log`). Pass as the `extend` hook to
 * `renderPage`/`createEngine` for an imported Eleventy theme:
 *
 *   renderPage({ ...input, templates, extend: registerEleventyCompat })
 *
 * Everything else a theme uses is either a LiquidJS built-in (`date`, `where`, …, already
 * present) or a **theme-defined JS filter** we can't import (`similarPosts`, `readableDate`, …).
 * Timber's engine runs with `strictFilters` off, so those unknown filters **degrade to
 * pass-through** rather than crashing the render — the theme's core reading path still renders.
 * All additive: nothing overrides a Timber/LiquidJS built-in.
 */

/** Eleventy's `slugify` (a slug for URLs): lowercase, non-alphanumerics → single dashes, trimmed. */
function slugify(value: unknown): string {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function registerEleventyCompat(engine: Liquid): void {
  // Eleventy's `url` filter prefixes the site's path prefix (its analogue of Timber's basePath),
  // and passes external/absolute URLs through. Root-relative paths get `site.basePath` prepended.
  engine.registerFilter('url', function (this: { context: { get(path: string[]): unknown } }, value: unknown) {
    const url = String(value ?? '');
    if (/^([a-z]+:)?\/\//i.test(url) || url.startsWith('#')) return url;
    const basePath = this.context.get(['site', 'basePath']);
    const prefix = typeof basePath === 'string' ? basePath : '';
    if (!url.startsWith('/')) return url;
    return `${prefix}${url}`;
  });
  engine.registerFilter('slugify', slugify);
  engine.registerFilter('slug', slugify);
  // Eleventy's debug `log` filter — a no-op passthrough here (it prints to the console at build).
  engine.registerFilter('log', (value: unknown) => value);
}
