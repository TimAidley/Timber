/**
 * Shared types for the generator core.
 *
 * The core is deliberately environment-agnostic: it never touches `fs`, the DOM,
 * or any framework. All values flow in as plain data so the same code renders in
 * the browser (preview) and in Node (CI build) — see SPEC §6.
 */

/** Parsed front matter: an object of arbitrary, tolerant key/value data (SPEC §5). */
export type FrontMatter = Record<string, unknown>;

/** Result of splitting an `index.md` into structured data + Markdown body. */
export interface ParsedDocument {
  /** YAML front matter, parsed to a plain object (empty object if none). */
  data: FrontMatter;
  /** The Markdown body with front matter removed. */
  body: string;
}

/** Site-wide context exposed to templates as `{{ site }}`. */
export type SiteContext = Record<string, unknown>;

/** Input to {@link renderPage}. */
export interface RenderPageInput {
  /** Raw `index.md` contents (YAML front matter + Markdown body). */
  markdown: string;
  /** The Liquid template source to render the page with. */
  template: string;
  /** Optional site-wide context exposed as `{{ site }}`. */
  site?: SiteContext;
}
