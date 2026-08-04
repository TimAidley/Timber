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
 * COLOURS — brand ink, not the surrounding text colour. The wordmark is a logo, so it has
 * to read the same on every site and in every slot on a page. Inheriting `currentColor`
 * (what this used to do when a theme defined no `--fg`/`--muted`) meant that dropping it
 * into a footer styled with muted text produced a faded logo with no full-ink "Tim" — the
 * two-tone contrast that *is* the wordmark collapsed into whatever the surrounding text
 * happened to be. So the values are fixed here, taken from the editor chrome's own tokens
 * (`@timber/app` `styles.css` `--text` / `--text-muted`) so header ≡ shortcode.
 *
 * DARK MODE — via `light-dark()`, which keys off the **page's declared `color-scheme`**,
 * not the viewer's OS preference. That distinction matters: `prefers-color-scheme` would
 * flip the logo to near-white on a light-only site whenever the *visitor* runs their OS in
 * dark mode, which is both common and invisible. The cost is that a dark theme must declare
 * `color-scheme: dark` (or `light dark`) for the flip to happen — good practice regardless,
 * since it also drives form controls and scrollbars.
 *
 * ESCAPE HATCH — `--wordmark-ink` / `--wordmark-muted`, read as `var()` fallbacks so a
 * theme can set them on any ancestor and win. No automatic signal can catch a section that
 * bucks the page scheme (a dark footer band on a light page is the usual one), so that case
 * is served by saying so explicitly. In a browser too old for `light-dark()` the whole
 * declaration is invalid and colour simply inherits — degrading to the old behaviour.
 *
 * CASE — `text-transform: none`, because `text-transform` inherits: the wordmark is fixed
 * brand text, not prose, so a theme slot that case-transforms its contents (an uppercased
 * listing title is the usual one) must not turn "Timber" into "TIMBER".
 */
const WORDMARK_CSS =
  `@font-face{` +
  `font-family:'Fraunces Timber';font-style:normal;font-weight:100 900;font-display:swap;` +
  `src:url(${WORDMARK_FONT_DATA_URI}) format('woff2')}` +
  `.wordmark{` +
  `font-family:'Fraunces Timber',Georgia,'Times New Roman',serif;font-optical-sizing:auto;` +
  `font-weight:440;letter-spacing:-0.005em;text-transform:none;` +
  `color:var(--wordmark-muted,light-dark(#5b6472,#9aa4b4));white-space:nowrap}` +
  `.wordmark__tim{font-weight:800;color:var(--wordmark-ink,light-dark(#1b2230,#e7eaf0));` +
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
