import { Liquid } from 'liquidjs';
import { registerComparisonFilters } from './filters.js';
import { registerContentFilters } from './contentFilters.js';
import { registerUrlFilters } from './urlFilters.js';
import { SafeHtml } from './safeHtml.js';
import type { TemplateMap } from './types.js';

export { SafeHtml };

// LiquidJS's built-in `escape` filter map — matched exactly so escaped output is
// byte-identical to what `outputEscape: 'escape'` would produce.
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&#34;',
  "'": '&#39;',
};

/**
 * The default output escaper: HTML-escape every `{{ output }}` — so untrusted
 * front-matter / config values (title, description, nav labels, slugs…) can never
 * inject markup — EXCEPT values wrapped in {@link SafeHtml}, which pass through raw.
 * The one such value is the already-rendered, already-sanitized body (`content`), so
 * `{{ content }}` stays raw with no `| raw` needed; `{{ content | raw }}` also works
 * (LiquidJS skips `outputEscape` when the final filter is `raw`).
 */
function outputEscape(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  const str = value == null ? '' : String(value);
  return str.replace(/[&<>"']/g, (m) => ESCAPE_MAP[m]!);
}

/**
 * Construct the Timber LiquidJS engine.
 *
 * `jsTruthy: true` is a settled decision (SPEC §6 / CLAUDE.md): it avoids
 * Shopify-style truthiness surprises where a blank string is truthy. LiquidJS is
 * safe-by-construction (AST, no `eval`/`new Function`), which is why it can be
 * edited in-browser.
 *
 * Escaping is on by default (see {@link outputEscape}) so template output is safe
 * unless a value is explicitly trusted HTML. This is a security default that does
 * NOT change how existing themes are written: `{{ content }}` still renders the body
 * as HTML because `content` is passed as {@link SafeHtml}.
 *
 * Pass `templates` (a bare-name → source map) to enable **layout inheritance** and
 * **`{% render %}` snippets** (SPEC §6): LiquidJS resolves `{% layout %}`/`{% render %}`/
 * `{% include %}` against this in-memory map — no filesystem, so the same engine works
 * in the browser and Node (preview ≡ build). Omit it for a single self-contained template.
 */
export function createEngine(
  templates?: TemplateMap,
  extend?: (engine: Liquid) => void,
): Liquid {
  const engine = new Liquid({
    jsTruthy: true,
    outputEscape,
    // `templates` makes LiquidJS resolve partials/layouts from the map instead of `fs`.
    ...(templates ? { templates } : {}),
  });
  // Comparison query filters (SPEC §6) — `where` is equality-only, so these add
  // `where_gt`/`where_gte`/`where_lt`/`where_lte`/`where_ne`/`where_between` + `days_between`.
  registerComparisonFilters(engine);
  // Content filters: `markdownify`, for the fields a site owner writes as Markdown
  // (SPEC §13) — kept apart from the query filters above, which are pure and synchronous.
  registerContentFilters(engine);
  // URL filters: `relative_url` / `absolute_url` (prefix `site.basePath` / `site.baseUrl`).
  // A cleaner link idiom for Timber's own themes, and the highest-frequency Jekyll filters.
  registerUrlFilters(engine);
  // Extension seam: an optional hook to register extra filters/tags on the engine — the
  // clean plug-in point a compatibility layer (e.g. @timber/jekyll-compat) uses to add its
  // ecosystem filters/tags without the core depending on it. Applied last so an extension
  // can override a built-in if it deliberately needs to.
  extend?.(engine);
  return engine;
}

/** A shared default engine instance for the common (no-partials) render path. */
export const engine = createEngine();
