import type { Liquid } from 'liquidjs';
import { renderMarkdown, renderMarkdownInline } from './markdown.js';
import { SafeHtml } from './safeHtml.js';

/**
 * Content filters — the ones that render Markdown from inside a template (SPEC §13).
 *
 * Only the page *body* is Markdown by default (`{{ content }}`); every other value is
 * HTML-escaped on output, so a site owner who writes `:timber-logo` or `[contact](/contact)`
 * into a settings field gets the literal text back. `markdownify` is the opt-in:
 *
 *   <p>{{ site.copyright | markdownify }}</p>
 *
 * It runs the ordinary SPEC §6 pipeline, so a Markdown-rendered field gets exactly what a
 * body gets — the `:timber-logo` shortcode, links, emphasis — under exactly the same
 * `rehype-sanitize` guarantees. Reusing the pipeline is the point: nothing here re-implements
 * escaping or the shortcode markup, so neither can drift from the body's behaviour.
 *
 * Output is wrapped in {@link SafeHtml} because it is already sanitized HTML — without that
 * the engine's default escaper would turn the markup back into visible angle brackets.
 *
 * Kept out of `filters.ts`, which documents its query filters as pure and synchronous;
 * these are neither (Markdown rendering is async). LiquidJS resolves a promise-returning
 * filter before applying `outputEscape`, and Timber renders through the async
 * `parseAndRender`, so `await` here is safe.
 */
export function registerContentFilters(engine: Liquid): void {
  // Inline by default: a one-line field (a copyright notice, a tagline) loses the `<p>`
  // Markdown would otherwise wrap it in, so it drops into the surrounding markup instead
  // of nesting a block inside it. Anything with real structure keeps its blocks.
  engine.registerFilter(
    'markdownify',
    async (input: unknown) => new SafeHtml(await renderMarkdownInline(str(input))),
  );
  // The block-level form, for a field that genuinely holds paragraphs and wants them wrapped
  // even when there is only one. Native in its own right, so it lives here rather than in
  // `@timber/jekyll-compat` (whose charter is filters Timber does NOT ship) — and it doubles
  // as the target the Jekyll importer rewrites `| markdownify` to, Jekyll's filter being
  // block-level.
  engine.registerFilter(
    'markdownify_block',
    async (input: unknown) => new SafeHtml(await renderMarkdown(str(input))),
  );
}

/** Render nil as empty rather than the string "undefined"/"null". */
function str(input: unknown): string {
  return input == null ? '' : String(input);
}
