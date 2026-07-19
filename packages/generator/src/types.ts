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
  /**
   * Optional engine-extension hook (a compat layer registering extra filters/tags — e.g.
   * `@timber/jekyll-compat`'s `registerJekyllCompat`). Applied when the engine is built;
   * engines are cached per (templates, extend) pair so a whole build still builds one
   * engine. The core never depends on any specific extension — this is just the seam.
   */
  extend?: (engine: import('liquidjs').Liquid) => void;
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
  /**
   * Optional resolved URL of this page, merged into the page context as `{{ page.url }}`
   * (Tier-1). Supplied by the caller (which owns routing — homepage-at-root, base paths),
   * so the core stays pure. Powers canonical/self links, active-nav highlighting, and the
   * `page.url` a ported theme expects. Omit and `{{ page.url }}` is simply empty.
   */
  url?: string;
  /**
   * Optional owning collection-type name, merged into the page context as
   * `{{ page.collection }}` (Tier-1) — the analogue of Jekyll's `page.collection`.
   */
  collection?: string;
  /**
   * Optional resolved language of this page (SPEC §5 → Multilingual), merged into the
   * page context as `{{ page.lang }}` (winning over any front-matter `lang`). Supplied
   * by the caller — the generator core stays language-agnostic. Omit for a single-
   * language site (then `{{ page.lang }}` is simply empty).
   */
  lang?: string;
  /**
   * Optional sibling translations (SPEC §5 → Multilingual), merged into the page context
   * as `{{ page.translations }}` — each a `{ lang, url, title }` record — for a language
   * switcher. Assembled by `@timber/content`'s `translationsOf`; kept loose here so the
   * core needn't know the content model.
   */
  translations?: Array<Record<string, unknown>>;
  /**
   * Optional temporal context (SPEC §6): the build/preview instant, exposed at the top
   * level as `{{ now }}` (ISO-8601) and `{{ today }}` (`YYYY-MM-DD`). Supplied by the
   * caller (never read from the clock here, so preview ≡ build) — see {@link buildClock}.
   * Being top-level, `today` is directly usable in `where_exp` predicates, e.g.
   * `collections.events | where_exp: 'e', 'e.start >= today'`.
   */
  now?: string;
  today?: string;
}
