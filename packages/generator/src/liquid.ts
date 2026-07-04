import { Liquid } from 'liquidjs';

/**
 * Construct the Timber LiquidJS engine.
 *
 * `jsTruthy: true` is a settled decision (SPEC §6 / CLAUDE.md): it avoids
 * Shopify-style truthiness surprises where a blank string is truthy. LiquidJS is
 * safe-by-construction (AST, no `eval`/`new Function`), which is why it can be
 * edited in-browser.
 *
 * Note on escaping: LiquidJS does NOT HTML-escape `{{ output }}` by default, so
 * the already-rendered body HTML passed as `content` is emitted verbatim. Template
 * authors opt into escaping explicitly via the `escape` filter where needed.
 */
export function createEngine(): Liquid {
  return new Liquid({
    jsTruthy: true,
  });
}

/** A shared default engine instance for the common render path. */
export const engine = createEngine();
