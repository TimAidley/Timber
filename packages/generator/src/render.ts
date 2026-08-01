import { Liquid } from 'liquidjs';
import { parseFrontMatter } from './frontmatter.js';
import { renderMarkdown } from './markdown.js';
import { injectWordmarkStyle } from './wordmarkStyle.js';
import { rebaseHtml } from './links.js';
import { engine, createEngine, SafeHtml } from './liquid.js';
import type { RenderPageInput, TemplateMap } from './types.js';

/**
 * Engines bound to a template map, cached by the map's identity so a whole build (or a
 * preview session) — which reuses one `templates` object across every page — constructs
 * the engine once instead of per page. A `WeakMap` means the engine is collected with
 * its map. Without a map, the shared `engine` singleton (no partials/layouts) is used.
 */
const engineByTemplates = new WeakMap<TemplateMap, Liquid>();
// When an `extend` hook is supplied (a compat layer registering extra filters/tags), cache
// per (templates, extend) pair — a whole build reuses one of each, so this stays a single
// engine per build, same as the no-extend path.
const engineByTemplatesExtended = new WeakMap<
  TemplateMap,
  WeakMap<(engine: Liquid) => void, Liquid>
>();

function engineFor(
  templates: TemplateMap | undefined,
  extend?: (engine: Liquid) => void,
): Liquid {
  if (!extend) {
    if (!templates) return engine;
    let bound = engineByTemplates.get(templates);
    if (!bound) {
      bound = createEngine(templates);
      engineByTemplates.set(templates, bound);
    }
    return bound;
  }
  // With an extend hook. No template map is a rare edge (a self-contained template that
  // still wants extensions) — build an uncached engine for it.
  if (!templates) return createEngine(undefined, extend);
  let byExtend = engineByTemplatesExtended.get(templates);
  if (!byExtend) {
    byExtend = new WeakMap();
    engineByTemplatesExtended.set(templates, byExtend);
  }
  let bound = byExtend.get(extend);
  if (!bound) {
    bound = createEngine(templates, extend);
    byExtend.set(extend, bound);
  }
  return bound;
}

/**
 * Render a single page: split front matter from body, render the Markdown body to
 * HTML, then render the Liquid template with the assembled context.
 *
 * This function is **pure** — no filesystem, DOM, or network access — which is
 * what makes browser preview and Node build byte-identical (SPEC §6). Callers in
 * different environments supply the strings; the rendering is the same code.
 *
 * Template context:
 *   - `page`        — parsed front-matter data (plus computed `lang`/`translations`)
 *   - `content`     — the rendered body HTML (emitted raw; see liquid.ts)
 *   - `site`        — optional site-wide context
 *   - `collections` — optional per-type collections (for listing loops)
 *   - `paginator`   — optional pagination context, on one page of a paginated listing
 *
 * When `input.templates` is supplied, the `template` may `{% layout %}` / `{% render %}`
 * / `{% include %}` those templates (SPEC §6). Resolution is in-memory (no filesystem),
 * so this stays pure and preview ≡ build.
 */
export async function renderPage(input: RenderPageInput): Promise<string> {
  const { data, body } = parseFrontMatter(input.markdown);
  // A body has no `relative_url` to reach for, so an author writes `[About](/about)` and
  // means the site root. On a project-Pages site served under `/repo/` that is not the
  // server root, so the base path is applied here — the body-side counterpart of the
  // filter templates use. No-op on a root site (`basePath` is ''), where it is already
  // correct as written.
  const basePath = typeof input.site?.basePath === 'string' ? input.site.basePath : '';
  const content = rebaseHtml(await renderMarkdown(body), { basePath });

  const html = await engineFor(input.templates, input.extend).parseAndRender(
    input.template,
    {
      // Eleventy data cascade (SPEC §2): theme `_data/*` globals, then (if flattened) the
      // page's own front matter, spread at the TOP LEVEL — so an imported Eleventy theme's
      // bare `{{ title }}`/`{{ metadata.x }}` resolve. Spread FIRST so the reserved names
      // below (page/content/site/…) always win and can never be shadowed; front matter is
      // spread after globals so it wins over them (closer-to-content, Eleventy's rule).
      // Both omitted for native/Jekyll themes → byte-identical `page.*`-only context.
      ...(input.globals ?? {}),
      ...(input.flattenData ? data : {}),
      // Computed language/translations (SPEC §5 → Multilingual) win over any same-named
      // front-matter key, mirroring the model where the path is authoritative for `lang`.
      page: {
        ...data,
        ...(input.lang !== undefined ? { lang: input.lang } : {}),
        ...(input.translations !== undefined ? { translations: input.translations } : {}),
        // Computed page fields (Tier-1). `page.url` is the object's resolved URL — useful for
        // canonical/self links and active-nav in Timber's own themes, and the single most
        // common thing a ported theme reads off `page`. `page.collection` names the owning
        // collection type. `page.content` mirrors the rendered body so a theme that reads
        // `page.content` (as well as the bare `{{ content }}`) works. All are caller-supplied
        // or derived here — never read from fs/DOM — so preview ≡ build. Computed keys win
        // over same-named front matter, matching `lang`/`translations` above.
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.collection !== undefined ? { collection: input.collection } : {}),
        content: new SafeHtml(content),
      },
      // The body is already rendered + sanitized HTML — mark it trusted so `{{ content }}`
      // emits it raw while every other output is auto-escaped (see liquid.ts).
      content: new SafeHtml(content),
      site: input.site ?? {},
      collections: input.collections ?? {},
      seo: input.seo ?? {},
      // One page of a paginated listing (SPEC §13). Deliberately left *undefined* rather
      // than defaulted to `{}` for an ordinary page, so a theme can gate its listing markup
      // on `{% if paginator %}` — an empty object would be truthy under `jsTruthy`.
      paginator: input.paginator,
      // Layout-scoped data (Jekyll's `layout.*`), supplied by the import path. Omitted for
      // native pages, where `{{ layout.x }}` is simply empty.
      layout: input.layout ?? {},
      // Temporal context (SPEC §6): top-level so `where_exp`/comparison filters can read
      // `today`/`now` directly. Omitted keys simply render as empty.
      now: input.now,
      today: input.today,
    },
  );

  // Brand-wordmark styling (SPEC §7), added once over the finished document — the logo can
  // arrive from the body, an excerpt, or a `markdownify`-ed setting, and every route needs
  // the same self-contained `<style>`. A no-op on pages with no wordmark.
  return injectWordmarkStyle(html);
}
