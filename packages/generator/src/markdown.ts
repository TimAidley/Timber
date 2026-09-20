import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkDirective from 'remark-directive';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from 'rehype-sanitize';
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
// The `:timber-logo` shortcode (SPEC §7 → Brand wordmark) renders to nested <span>s;
// permit only its `wordmark`/`wordmark__tim` classes (<span> is already an allowed tag).
// The `::embed` directive (SPEC §7 → Embeds) renders the facade the `{% embed %}` tag
// also emits: a <div> holding a link over a poster and the play icon. Every addition is
// pinned to a value pattern rather than merely to a tag, because this markup is built by
// `embedMarkup.ts` and nothing else may wear its shape: the `style` attribute only ever
// carries `--embed-ratio`, and `data-embed-src` — the URL the click-to-load script loads
// into an iframe — only ever an https URL. <svg>/<path> are allowed as tags with a fixed
// attribute set (no href, no event handlers), which is what keeps the icon from being a
// hole; an author cannot reach any of this, since raw HTML in a body never becomes an
// element (remark-rehype runs without `allowDangerousHtml`).
/**
 * One entry in a sanitize schema's per-tag attribute list: a bare property name (any
 * value allowed) or the name followed by the values it may take.
 */
type AttributeRule = string | [string, ...Array<string | number | boolean | RegExp>];

/**
 * Extend a tag's allowed attributes, **merging** into any existing rule for the same
 * property instead of appending a second one — hast-util-sanitize reads the first rule
 * it finds for a property and ignores the rest, so an appended rule for a property the
 * default schema already constrains is silently dead. (`a` already carries a `className`
 * rule for footnote backrefs, which is exactly how this was found: the class on the
 * facade's link came out empty.)
 */
function extend(base: AttributeRule[] = [], additions: AttributeRule[]): AttributeRule[] {
  const out = [...base];
  for (const addition of additions) {
    const name = Array.isArray(addition) ? addition[0] : addition;
    const at = out.findIndex((rule) => (Array.isArray(rule) ? rule[0] : rule) === name);
    if (at === -1) {
      out.push(addition);
    } else if (!Array.isArray(out[at]) || !Array.isArray(addition)) {
      // Either side allowing any value makes the merged rule unconstrained.
      out[at] = name;
    } else {
      out[at] = [name, ...out[at].slice(1), ...addition.slice(1)];
    }
  }
  return out;
}

const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'figure', 'figcaption', 'svg', 'path'],
  attributes: {
    ...defaultSchema.attributes,
    code: extend(defaultSchema.attributes?.code as AttributeRule[], [
      ['className', /^language-./],
    ]),
    figure: extend(defaultSchema.attributes?.figure as AttributeRule[], [
      ['className', /^fig(--[a-z-]+)?$/],
    ]),
    img: extend(defaultSchema.attributes?.img as AttributeRule[], [
      'loading',
      'decoding',
      ['className', /^embed__poster$/],
    ]),
    span: extend(defaultSchema.attributes?.span as AttributeRule[], [
      ['className', /^(wordmark(__tim)?|embed__play)$/],
    ]),
    div: extend(defaultSchema.attributes?.div as AttributeRule[], [
      ['className', /^embed(--(inline|newtab))?$/],
      [
        'style',
        /^--embed-ratio:(auto|[\d.\s/]+)(;--embed-width:[\d.]+(px|rem|em|ch|%|vw|vh))?$/,
      ],
      ['data-embed-src', /^https:\/\//],
      'data-embed-title',
      ['data-embed-frame-ratio', /^[\d.\s/]+$/],
      ['data-embed-frame-width', /^[\d.]+(px|rem|em|ch|%|vw|vh)$/],
    ]),
    a: extend(defaultSchema.attributes?.a as AttributeRule[], [
      ['className', /^embed__launch$/],
      'target',
      'rel',
      'aria-label',
    ]),
    svg: [['className', /^embed__play-icon$/], 'viewBox', 'aria-hidden', 'focusable'],
    path: ['d'],
  },
};

// The SPEC §6 Markdown pipeline, assembled once and reused. Pure JS, identical in
// browser and Node. remark-frontmatter is included so a stray front-matter block
// in the body is recognised and dropped rather than rendered as a `---` rule.
// rehype-highlight is swappable for shiki later without touching callers.
// Built by a factory so the block and inline variants below are the SAME pipeline —
// they must not drift, since both render author content under the same guarantees.
function pipeline({ breaks = false }: { breaks?: boolean } = {}) {
  return (
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter, ['yaml'])
      .use(remarkDirective)
      .use(remarkFigure)
      // Newline → <br>, for the inline variant only (see `renderMarkdownInline`). Must run
      // before the remark→rehype bridge, being an mdast transform.
      .use(breaks ? [remarkBreaks] : [])
      .use(remarkRehype)
      .use(rehypeSanitize, sanitizeSchema)
      // The `:timber-logo` styling (@font-face + rules) is NOT injected here: a wordmark can
      // reach a page from a body, an excerpt, or a `markdownify`-ed setting, so it is injected
      // once over the assembled page instead (`injectWordmarkStyle`, applied by `renderPage`).
      .use(rehypeHighlight)
  );
}

/** Minimal hast shape this transform reads (avoids a hard `@types/hast` dep). */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

/**
 * Unwrap a lone `<p>`, so a one-line fragment renders as inline HTML.
 *
 * Markdown has no notion of "just this text": `© 2026 Acme` parses to a paragraph, and
 * the `<p>` it produces would nest inside whatever markup the value is dropped into.
 * A document with any more structure than a single paragraph (two paragraphs, a list,
 * a heading) keeps its blocks — this only removes a wrapper that has nothing to wrap.
 */
function rehypeUnwrapParagraph() {
  return (tree: unknown): void => {
    const root = tree as HastNode;
    const children = root.children ?? [];
    // Whitespace between blocks is a text node in hast; a trailing newline must not
    // count as a second child and defeat the unwrap.
    const blocks = children.filter(
      (child) => !(child.type === 'text' && !(child.value ?? '').trim()),
    );
    const only = blocks[0];
    if (blocks.length !== 1 || only?.type !== 'element' || only.tagName !== 'p') return;
    root.children = only.children ?? [];
  };
}

const processor = pipeline().use(rehypeStringify);
const inlineProcessor = pipeline({ breaks: true })
  .use(rehypeUnwrapParagraph)
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

/**
 * Render a short Markdown *fragment* — a settings field, not a page body — to inline
 * HTML. Same directives and same sanitising as {@link renderMarkdown}, with two
 * deliberate differences for the shape of content a *field* holds:
 *
 *   - a single paragraph loses its `<p>` wrapper, so the result drops straight into
 *     surrounding template markup rather than nesting a block inside it;
 *   - a newline becomes a `<br>` rather than a soft break.
 *
 * The second is a departure from standard Markdown, and deliberate. Rendering a newline
 * as a space is a *prose* convention — it lets a body be hard-wrapped in source without
 * affecting output. A field is not prose: it is a two-line address or a copyright notice
 * typed into a form, where a newline can only mean a line break. Standard behaviour would
 * make a site owner discover that a lone newline does nothing and that the fix is two
 * invisible trailing spaces — through a `text` input that cannot produce a newline anyway,
 * and YAML that folds one in a plain scalar. This is the same rule Liquid's
 * `newline_to_br` gives, which is what themes reach for here.
 *
 * Bodies keep standard semantics: {@link renderMarkdown} is untouched.
 *
 * This is what backs the `markdownify` Liquid filter.
 */
export async function renderMarkdownInline(markdown: string): Promise<string> {
  const file = await inlineProcessor.process(markdown);
  return String(file);
}
