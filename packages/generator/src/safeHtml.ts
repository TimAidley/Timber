/**
 * Marker for pre-sanitized, trusted HTML that must NOT be re-escaped on output.
 * Wrapping the value — rather than requiring templates to write `{{ content | raw }}` —
 * keeps a bare `{{ content }}` working (the form every existing theme already uses) while
 * still escaping every *other* output. Any string that is genuinely trusted HTML can be
 * wrapped in this; nothing else is.
 *
 * Currently that means the rendered Markdown body (`content`, see `render.ts`) and the
 * output of the `markdownify` filter (`contentFilters.ts`) — both of which have been
 * through `rehype-sanitize`.
 *
 * It lives in its own module rather than beside the engine so the filter modules can
 * mark their output trusted without importing `liquid.ts`, which imports *them*.
 */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}
