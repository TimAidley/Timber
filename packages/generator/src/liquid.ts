import { Liquid } from 'liquidjs';

/**
 * Construct the Timber LiquidJS engine.
 *
 * `jsTruthy: true` is a settled decision (SPEC §6 / CLAUDE.md): it avoids
 * Shopify-style truthiness surprises where a blank string is truthy. LiquidJS is
 * safe-by-construction (AST, no `eval`/`new Function`), which is why it can be
 * edited in-browser.
 *
 * Escaping: `outputEscape: 'escape'` makes every `{{ output }}` HTML-escaped by
 * default, so untrusted front-matter / config values (title, description, nav
 * labels, slugs…) can never inject markup into the generated page. The one value
 * that is intentionally HTML — the already-rendered, already-sanitized body — is
 * emitted with `{{ content | raw }}`. Templates opt into raw output *explicitly*,
 * so raw is a visible, auditable decision rather than the silent default.
 */
export function createEngine(): Liquid {
  return new Liquid({
    jsTruthy: true,
    outputEscape: 'escape',
  });
}

/** A shared default engine instance for the common render path. */
export const engine = createEngine();
