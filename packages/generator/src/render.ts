import { parseFrontMatter } from './frontmatter.js';
import { renderMarkdown } from './markdown.js';
import { engine, SafeHtml } from './liquid.js';
import type { RenderPageInput } from './types.js';

/**
 * Render a single page: split front matter from body, render the Markdown body to
 * HTML, then render the Liquid template with the assembled context.
 *
 * This function is **pure** — no filesystem, DOM, or network access — which is
 * what makes browser preview and Node build byte-identical (SPEC §6). Callers in
 * different environments supply the strings; the rendering is the same code.
 *
 * Template context:
 *   - `page`        — parsed front-matter data
 *   - `content`     — the rendered body HTML (emitted raw; see liquid.ts)
 *   - `site`        — optional site-wide context
 *   - `collections` — optional per-type collections (for listing loops)
 */
export async function renderPage(input: RenderPageInput): Promise<string> {
  const { data, body } = parseFrontMatter(input.markdown);
  const content = await renderMarkdown(body);

  const html = await engine.parseAndRender(input.template, {
    page: data,
    // The body is already rendered + sanitized HTML — mark it trusted so `{{ content }}`
    // emits it raw while every other output is auto-escaped (see liquid.ts).
    content: new SafeHtml(content),
    site: input.site ?? {},
    collections: input.collections ?? {},
    seo: input.seo ?? {},
  });

  return html;
}
