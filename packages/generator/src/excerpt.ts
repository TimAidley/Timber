import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkDirective from 'remark-directive';
import { renderMarkdown } from './markdown.js';
import { rebaseHtml, type RebaseOptions } from './links.js';

/**
 * Post excerpts for listing pages (SPEC §6). A listing template only ever sees other
 * objects' *front matter* — it has no access to their bodies — so "show the opening of
 * each post on the home page", which every blog theme wants, is impossible to express
 * in Liquid alone. This computes it in the generator instead, and `collections`
 * carries the result (compute in the generator, format in templates).
 *
 * The split happens on the **Markdown source**, and the resulting prefix is rendered
 * through the ordinary {@link renderMarkdown} pipeline. That matters: the excerpt HTML
 * is therefore exactly what the full page would have produced for those same blocks —
 * same figure handling, same sanitisation, same highlighting — rather than a second,
 * subtly different renderer.
 */

/** Minimal mdast shape this reads (avoids a hard `@types/mdast` dep, as elsewhere). */
interface MdNode {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/**
 * The explicit cut marker — an HTML comment, matching Hugo, Jekyll and WordPress, so
 * imported content keeps working and the convention is one people already know. It
 * survives Timber's byte-stable Milkdown round-trip (it parses as an mdast `html` node
 * and serialises back verbatim), which is why it can live in a body the editor owns.
 */
const MORE = /^<!--\s*more\s*-->$/;

// Parse only — no rehype stage. Mirrors the render pipeline's remark plugins so blocks
// are recognised identically; `remarkDirective` in particular keeps a `:::figure` as one
// container node, so the cut can never land inside a directive.
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkDirective);

/** Is there anything but whitespace left after `offset`? */
function hasMoreAfter(source: string, offset: number): boolean {
  return source.slice(offset).trim().length > 0;
}

/**
 * Split a Markdown body into its excerpt prefix and whether anything was left behind.
 *
 * Two rules, in order:
 *
 * 1. **An explicit `<!--more-->`** cuts there. This is the control an author reaches for
 *    when the opening they want is more than one paragraph — or, as in a post that opens
 *    with a floated figure, when the excerpt should carry an image with it.
 * 2. **Otherwise the first paragraph**, together with any blocks before it. Leading
 *    non-prose (a figure, an image) therefore stays attached to the sentence it belongs
 *    with, instead of the excerpt being an orphaned picture.
 *
 * A body with no paragraph at all is returned whole and untruncated — there is no prose
 * to cut at, and silently emitting nothing would look like a bug.
 *
 * `truncated` is what a theme gates its "Read more" link on. A short post whose whole
 * body *is* its excerpt reports `false`, so it renders complete with no misleading link.
 */
export function splitExcerpt(body: string): { markdown: string; truncated: boolean } {
  const root = parser.parse(body) as unknown as { children?: MdNode[] };
  const nodes = root.children ?? [];

  for (const node of nodes) {
    if (node.type !== 'html' || !MORE.test((node.value ?? '').trim())) continue;
    const cut = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (cut == null || end == null) break;
    return { markdown: body.slice(0, cut), truncated: hasMoreAfter(body, end) };
  }

  for (const node of nodes) {
    if (node.type !== 'paragraph') continue;
    const cut = node.position?.end.offset;
    if (cut == null) break;
    return { markdown: body.slice(0, cut), truncated: hasMoreAfter(body, cut) };
  }

  return { markdown: body, truncated: false };
}

/**
 * Render a body's excerpt to an HTML fragment. See {@link splitExcerpt} for the rule.
 * The HTML is a prefix of what the full page renders, produced by the same pipeline.
 *
 * References are rewritten for the listing this will be shown on — see {@link rebaseHtml}:
 * `base` is the URL the body's own page is served at (base path included), against which
 * relative references resolve, and `basePath` is prefixed onto root-relative ones.
 */
export async function renderExcerpt(
  body: string,
  options: RebaseOptions = {},
): Promise<{ html: string; truncated: boolean }> {
  const { markdown, truncated } = splitExcerpt(body);
  return { html: rebaseHtml(await renderMarkdown(markdown), options), truncated };
}
