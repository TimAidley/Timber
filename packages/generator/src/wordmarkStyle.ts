import { WORDMARK_FONT_DATA_URI } from './wordmarkFont.js';

/**
 * Self-contained styling for the `:timber-logo` wordmark shortcode (SPEC §7 → Brand
 * wordmark). The `remarkFigure` transform emits the `.wordmark` / `.wordmark__tim`
 * spans; this module gives them their look by injecting a single `<style>` — the
 * `@font-face` for the embedded Fraunces logo face plus the two rules — into any page
 * that uses the shortcode.
 *
 * Why here (generator) and not the theme: brand styling that must be identical on every
 * Timber site can't depend on each site's `theme.css` carrying the rules + font, which
 * drifts and goes stale (a per-site copy is exactly what breaks). Emitting it from the
 * version-pinned generator makes the logo work on ANY site with zero theme changes.
 *
 * Why per PAGE, not per Markdown document: the wordmark reaches a page by more than one
 * route — the body (`:timber-logo` in `index.md`), an excerpt on a listing page, and a
 * settings field rendered with `markdownify` (e.g. the footer copyright). Injecting from
 * inside the Markdown pipeline would miss every route but the first — a footer wordmark on
 * a page whose body has no shortcode would get correct spans and no font — and would emit
 * one `<style>` per excerpt on a listing page. Injecting once over the assembled document
 * covers every route and can't duplicate.
 *
 * The trusted `<style>` never passes through `rehype-sanitize` (it is added after the
 * template has run), so the sanitize schema stays locked down for untrusted content.
 * Author-typed raw HTML never becomes an element anyway — remark-rehype runs without
 * `allowDangerousHtml` — so no untrusted `<style>` exists to worry about.
 *
 * The colours resolve to the site's own `--fg` / `--muted` when present (matching the
 * body text, as in the editor header) and fall back to `currentColor` — with a muted
 * tint via `color-mix` — on themes that don't define them, so the two-tone survives.
 *
 * Exported because `docs/install.html` is a standalone page outside the generator's reach
 * and has to carry its own copy of this block; `scripts/gen-install-wordmark.mjs` writes
 * it there and `test/install-page.test.ts` fails if the two drift apart.
 */
export const WORDMARK_CSS =
  `@font-face{` +
  `font-family:'Fraunces Timber';font-style:normal;font-weight:100 900;font-display:swap;` +
  `src:url(${WORDMARK_FONT_DATA_URI}) format('woff2')}` +
  `.wordmark{` +
  `font-family:'Fraunces Timber',Georgia,'Times New Roman',serif;font-optical-sizing:auto;` +
  `font-weight:440;letter-spacing:-0.005em;` +
  `color:var(--muted,color-mix(in srgb,currentColor 62%,transparent));white-space:nowrap}` +
  `.wordmark__tim{font-weight:800;color:var(--fg,currentColor);` +
  `font-variation-settings:'SOFT' 12,'WONK' 1}`;

/** The `wordmark` class as it appears in rendered output, however the span was produced. */
const WORDMARK_CLASS = /class="[^"]*\bwordmark\b/;

/** Case-insensitive `</head>`, so the style lands in the head of a normal document. */
const HEAD_CLOSE = /<\/head\s*>/i;

/**
 * Add the wordmark `<style>` to a rendered page that uses the shortcode; return the HTML
 * untouched when it doesn't (no style, no embedded font on pages that never show a logo).
 *
 * Applied once to the assembled document, so it is injected exactly once no matter how
 * many logos appear or which route they arrived by (body, excerpt, `markdownify`-ed
 * setting). Normally inserted before `</head>`; a template that renders a bare fragment
 * (the advanced-area preview can) has no head, so there it is prepended instead — still
 * valid, and the rules still apply.
 */
export function injectWordmarkStyle(html: string): string {
  if (!WORDMARK_CLASS.test(html)) return html;
  const style = `<style>${WORDMARK_CSS}</style>`;
  const head = HEAD_CLOSE.exec(html);
  if (!head) return style + html;
  return html.slice(0, head.index) + style + html.slice(head.index);
}
