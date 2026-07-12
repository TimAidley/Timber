import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';
import { remarkFigure } from './figureDirective.js';

// remark-rehype already drops raw HTML (no `allowDangerousHtml`), but it does NOT
// filter URL *protocols*, so a `[x](javascript:…)` link or a `data:` image would
// survive into the output and execute on click. rehype-sanitize enforces a safe
// protocol allowlist (http/https/mailto/…) on `href`/`src`. It runs BEFORE
// rehype-highlight so the trusted highlighter spans it emits aren't stripped; we
// extend the default schema only to preserve the `language-*` class the highlighter
// needs to detect a fenced block's language.
// The `:::figure` directive (SPEC §7) renders to <figure>/<figcaption>/<img>. Allow
// those tags, the computed `fig*` layout classes on <figure>, and the lazy-loading
// hints on <img> — everything else stays locked to the safe default schema.
const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'figure', 'figcaption'],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
    figure: [...(defaultSchema.attributes?.figure ?? []), ['className', /^fig(--[a-z-]+)?$/]],
    img: [...(defaultSchema.attributes?.img ?? []), 'loading', 'decoding'],
  },
};

// The SPEC §6 Markdown pipeline, assembled once and reused. Pure JS, identical in
// browser and Node. remark-frontmatter is included so a stray front-matter block
// in the body is recognised and dropped rather than rendered as a `---` rule.
// rehype-highlight is swappable for shiki later without touching callers.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkDirective)
  .use(remarkFigure)
  .use(remarkRehype)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeHighlight)
  .use(rehypeStringify);

/**
 * Render a Markdown body to an HTML fragment. The input may be either the raw
 * `index.md` (front matter is stripped by the pipeline) or a body with front
 * matter already removed.
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await processor.process(markdown);
  return String(file);
}
