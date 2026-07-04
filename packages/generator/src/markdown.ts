import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';

// The SPEC §6 Markdown pipeline, assembled once and reused. Pure JS, identical in
// browser and Node. remark-frontmatter is included so a stray front-matter block
// in the body is recognised and dropped rather than rendered as a `---` rule.
// rehype-highlight is swappable for shiki later without touching callers.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkRehype)
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
