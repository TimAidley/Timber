import { Liquid } from 'liquidjs';

/**
 * Marker for pre-sanitized, trusted HTML (the rendered Markdown body) that must NOT
 * be re-escaped on output. Wrapping the value — rather than requiring templates to
 * write `{{ content | raw }}` — keeps a bare `{{ content }}` working (the form every
 * existing theme already uses) while still escaping every *other* output. Any string
 * that is genuinely trusted HTML can be wrapped in this; nothing else is.
 */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

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
 */
export function createEngine(): Liquid {
  return new Liquid({
    jsTruthy: true,
    outputEscape,
  });
}

/** A shared default engine instance for the common render path. */
export const engine = createEngine();
