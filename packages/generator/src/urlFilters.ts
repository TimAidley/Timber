import type { Liquid } from 'liquidjs';

/**
 * Native URL filters (Tier-1). Timber's own themes have written root-absolute links by
 * hand-concatenating `{{ site.basePath }}{{ url }}`; these filters make that a single,
 * less error-prone call — `{{ url | relative_url }}` — and they are *also* the two
 * highest-frequency filters in real Jekyll themes, so blessing them here closes the
 * biggest compatibility gap for free (a Jekyll theme's `relative_url`/`absolute_url`
 * calls just work). Semantics mirror Jekyll:
 *
 *   - `relative_url` prefixes the site's **base path** (Timber's `site.basePath`, the
 *     subpath a project-Pages site is served under — `/repo`, or `''` for a root site).
 *   - `absolute_url` prefixes the site's **base URL** (Timber's `site.baseUrl`, the full
 *     origin+path — e.g. `https://you.github.io/repo`).
 *
 * Both read the value from the current render context (not a closure) via the LiquidJS
 * filter `this.context`, so they stay pure and isomorphic — the same engine renders in
 * the browser preview and the Node build. An already-absolute input (`http(s)://…`) is
 * returned unchanged, matching how themes pass through external URLs.
 */

/** A LiquidJS filter's `this`: exposes the live render context for `getSync` lookups. */
interface FilterThis {
  context: { getSync(path: string[]): unknown };
}

function siteString(self: FilterThis, key: string): string {
  const value = self.context.getSync(['site', key]);
  return typeof value === 'string' ? value : '';
}

/** `foo` → `/foo`; `/foo` unchanged; `''` → `''` (so a bare base path stays clean). */
function ensureLeadingSlash(path: string): string {
  if (path === '') return '';
  return path.startsWith('/') ? path : `/${path}`;
}

function isAbsolute(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
}

/** Register `relative_url` / `absolute_url` on the engine (called from createEngine). */
export function registerUrlFilters(engine: Liquid): void {
  engine.registerFilter(
    'relative_url',
    function (this: FilterThis, input: unknown): string {
      const path = input == null ? '' : String(input);
      if (isAbsolute(path)) return path;
      const basePath = siteString(this, 'basePath'); // '' or '/repo' (no trailing slash)
      return `${basePath}${ensureLeadingSlash(path)}`;
    },
  );

  engine.registerFilter(
    'absolute_url',
    function (this: FilterThis, input: unknown): string {
      const path = input == null ? '' : String(input);
      if (isAbsolute(path)) return path;
      const baseUrl = siteString(this, 'baseUrl').replace(/\/+$/, ''); // no trailing slash
      return `${baseUrl}${ensureLeadingSlash(path)}`;
    },
  );
}
