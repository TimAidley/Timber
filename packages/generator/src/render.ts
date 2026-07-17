import { Liquid } from 'liquidjs';
import { parseFrontMatter } from './frontmatter.js';
import { renderMarkdown } from './markdown.js';
import { engine, createEngine, SafeHtml } from './liquid.js';
import type { RenderPageInput, TemplateMap } from './types.js';

/**
 * Engines bound to a template map, cached by the map's identity so a whole build (or a
 * preview session) — which reuses one `templates` object across every page — constructs
 * the engine once instead of per page. A `WeakMap` means the engine is collected with
 * its map. Without a map, the shared `engine` singleton (no partials/layouts) is used.
 */
const engineByTemplates = new WeakMap<TemplateMap, Liquid>();

function engineFor(templates: TemplateMap | undefined): Liquid {
  if (!templates) return engine;
  let bound = engineByTemplates.get(templates);
  if (!bound) {
    bound = createEngine(templates);
    engineByTemplates.set(templates, bound);
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
 *
 * When `input.templates` is supplied, the `template` may `{% layout %}` / `{% render %}`
 * / `{% include %}` those templates (SPEC §6). Resolution is in-memory (no filesystem),
 * so this stays pure and preview ≡ build.
 */
export async function renderPage(input: RenderPageInput): Promise<string> {
  const { data, body } = parseFrontMatter(input.markdown);
  const content = await renderMarkdown(body);

  const html = await engineFor(input.templates).parseAndRender(input.template, {
    // Computed language/translations (SPEC §5 → Multilingual) win over any same-named
    // front-matter key, mirroring the model where the path is authoritative for `lang`.
    page: {
      ...data,
      ...(input.lang !== undefined ? { lang: input.lang } : {}),
      ...(input.translations !== undefined ? { translations: input.translations } : {}),
    },
    // The body is already rendered + sanitized HTML — mark it trusted so `{{ content }}`
    // emits it raw while every other output is auto-escaped (see liquid.ts).
    content: new SafeHtml(content),
    site: input.site ?? {},
    collections: input.collections ?? {},
    seo: input.seo ?? {},
    // Temporal context (SPEC §6): top-level so `where_exp`/comparison filters can read
    // `today`/`now` directly. Omitted keys simply render as empty.
    now: input.now,
    today: input.today,
  });

  return html;
}
