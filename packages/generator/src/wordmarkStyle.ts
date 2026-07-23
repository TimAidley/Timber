import { visit } from 'unist-util-visit';
import { WORDMARK_FONT_DATA_URI } from './wordmarkFont.js';

/**
 * Self-contained styling for the `:timber-logo` wordmark shortcode (SPEC §7 → Brand
 * wordmark). The `remarkFigure` transform emits the `.wordmark` / `.wordmark__tim`
 * spans; this rehype plugin gives them their look by injecting a single `<style>` —
 * the `@font-face` for the embedded Fraunces logo face plus the two rules — into any
 * document that uses the shortcode.
 *
 * Why here (generator) and not the theme: brand styling that must be identical on every
 * Timber site can't depend on each site's `theme.css` carrying the rules + font, which
 * drifts and goes stale (a per-site copy is exactly what breaks). Emitting it from the
 * version-pinned generator makes the logo work on ANY site with zero theme changes.
 *
 * Why POST-sanitize: this runs after `rehype-sanitize`, so the trusted `<style>` we
 * generate reaches the output without loosening the sanitize schema to allow `<style>`
 * on (untrusted) content. Author-typed raw HTML never becomes an element (remark-rehype
 * runs without `allowDangerousHtml`), so no untrusted `<style>` exists to worry about.
 *
 * The colours resolve to the site's own `--fg` / `--muted` when present (matching the
 * body text, as in the editor header) and fall back to `currentColor` — with a muted
 * tint via `color-mix` — on themes that don't define them, so the two-tone survives.
 */
const WORDMARK_CSS =
  `@font-face{` +
  `font-family:'Fraunces Timber';font-style:normal;font-weight:100 900;font-display:swap;` +
  `src:url(${WORDMARK_FONT_DATA_URI}) format('woff2')}` +
  `.wordmark{` +
  `font-family:'Fraunces Timber',Georgia,'Times New Roman',serif;font-optical-sizing:auto;` +
  `font-weight:440;letter-spacing:-0.005em;` +
  `color:var(--muted,color-mix(in srgb,currentColor 62%,transparent));white-space:nowrap}` +
  `.wordmark__tim{font-weight:800;color:var(--fg,currentColor);` +
  `font-variation-settings:'SOFT' 12,'WONK' 1}`;

interface HastNode {
  type: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function hasWordmark(node: HastNode): boolean {
  const cls = node.properties?.className;
  return (
    node.type === 'element' &&
    node.tagName === 'span' &&
    Array.isArray(cls) &&
    cls.includes('wordmark')
  );
}

/**
 * Prepend the wordmark `<style>` to the tree the first time a `.wordmark` span is seen.
 * Injected once per document regardless of how many logos appear; documents without the
 * shortcode are untouched (no style, no embedded font).
 */
export function rehypeWordmarkStyle() {
  return (tree: unknown): void => {
    const root = tree as HastNode;
    let used = false;
    visit(root as never, (node: unknown) => {
      if (hasWordmark(node as HastNode)) used = true;
    });
    if (!used) return;
    const style: HastNode = {
      type: 'element',
      tagName: 'style',
      properties: {},
      children: [{ type: 'text', value: WORDMARK_CSS } as unknown as HastNode],
    };
    (root.children ??= []).unshift(style);
  };
}
