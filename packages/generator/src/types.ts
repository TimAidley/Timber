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

/**
 * The site's other templates, keyed by **bare name** (no `.liquid`), for resolving
 * `{% layout %}`, `{% render %}`, and `{% include %}` references (SPEC §6 block/layout
 * inheritance + `{% render %}` snippets). LiquidJS resolves these against this in-memory
 * map — no filesystem — so the same map works in the browser preview and the Node build,
 * keeping preview ≡ build. E.g. `{% layout 'default' %}` looks up the `default` key.
 */
export type TemplateMap = Record<string, string>;

/**
 * Collections context exposed to templates as `{{ collections }}` — collection-type
 * name → its entries (each entry a plain data record). The generator core stays
 * environment-agnostic, so this is deliberately loose; `@timber/content` assembles
 * the concrete shape (see its `Collections`/`CollectionEntry`).
 */
export type CollectionsContext = Record<string, Array<Record<string, unknown>>>;

/** Input to {@link renderPage}. */
export interface RenderPageInput {
  /** Raw `index.md` contents (YAML front matter + Markdown body). */
  markdown: string;
  /** The Liquid template source to render the page with (the layout-inheritance "child"). */
  template: string;
  /**
   * The site's other templates (keyed by bare name), so `template` can `{% layout %}` /
   * `{% render %}` / `{% include %}` them (SPEC §6). Omit for a self-contained template.
   */
  templates?: TemplateMap | undefined;
  /** Optional site-wide context exposed as `{{ site }}`. */
  site?: SiteContext;
  /** Optional per-type collections exposed as `{{ collections }}` (SPEC §6). */
  collections?: CollectionsContext;
  /** Optional per-page derived data (e.g. SEO) exposed as `{{ seo }}` (SPEC §13). */
  seo?: Record<string, unknown>;
}
