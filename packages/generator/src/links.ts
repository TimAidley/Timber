/**
 * Link rewriting for rendered Markdown bodies.
 *
 * Templates get `relative_url` / `absolute_url` to compose URLs against the site's base
 * path. A Markdown **body** has no filters — an author just writes `[Portfolio](/portfolio)`
 * or `![Alt](photo.jpg)` — so the same two adjustments have to be applied to the rendered
 * HTML instead. Both are about the difference between where a reference is *written* and
 * where it is *served*:
 *
 *   - **Root-relative** (`/portfolio`) means "from the site root". On a project-Pages site
 *     served under `/repo/`, the site root is not the server root, so it needs the base
 *     path — exactly what `relative_url` does for templates.
 *   - **Relative** (`photo.jpg`) means "next to this object's `index.md`". That resolves on
 *     the object's own page and nowhere else, so it needs resolving before the markup is
 *     lifted somewhere else (a listing excerpt).
 */

// Attribute values rehype-stringify emits for links and media. It always double-quotes,
// so a double-quote-delimited match is exact rather than a general HTML-parsing attempt.
const REF_ATTR = /\b(src|href)="([^"]*)"/gi;

/** `https://…`, `mailto:…`, `//cdn…` — already unambiguous, never rewritten. */
function isExternal(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
}

export interface RebaseOptions {
  /**
   * The URL the body's own page is served at, base path included. Relative references
   * are resolved against it. Omit to leave relative references alone — correct when the
   * markup is being rendered *into* that page, where they already resolve.
   */
  base?: string;
  /**
   * The site's base path (`site.basePath`: `/repo`, or `''` for a root site). Prefixed
   * onto root-relative references so `/portfolio` means the site root rather than the
   * server root.
   */
  basePath?: string;
}

/**
 * Rewrite `src`/`href` references in a rendered Markdown fragment. See {@link RebaseOptions}.
 * External, protocol-relative and fragment-only references pass through untouched, as does
 * everything else when neither option is supplied.
 */
export function rebaseHtml(html: string, options: RebaseOptions = {}): string {
  const { base = '', basePath = '' } = options;
  if (!base && !basePath) return html;

  return html.replace(REF_ATTR, (whole, attr: string, value: string) => {
    if (value === '' || value.startsWith('#') || isExternal(value)) return whole;

    if (value.startsWith('/')) {
      // Root-relative: only the base path is missing. Deliberately *not* run through the
      // URL resolver — `/a/../b` is the author's business, and rewriting it would change
      // bytes on every root site for no benefit.
      return basePath ? `${attr}="${basePath}${value}"` : whole;
    }

    if (!base) return whole;
    // A throwaway origin makes the standard resolver do the `./` and `../` work; only
    // the path parts are kept, so the origin never reaches the output.
    const url = new URL(value, `https://timber.invalid${base}`);
    return `${attr}="${url.pathname}${url.search}${url.hash}"`;
  });
}
