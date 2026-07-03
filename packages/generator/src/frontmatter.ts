import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { parse as parseYaml } from 'yaml';
import type { FrontMatter, ParsedDocument } from './types.js';

// A parser that only understands enough to locate a leading YAML front-matter
// block. We reuse remark-frontmatter (SPEC §6) rather than a hand-rolled regex so
// front-matter detection matches exactly what the render pipeline sees.
const frontmatterParser = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']);

/** Minimal shape of the mdast `yaml` node we care about (avoids depending on the
 * remark-frontmatter type augmentation of `mdast`). */
interface YamlNode {
  type: 'yaml';
  value: string;
  position?: { end: { offset?: number } };
}

function isYamlNode(node: unknown): node is YamlNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { type?: unknown }).type === 'yaml' &&
    typeof (node as { value?: unknown }).value === 'string'
  );
}

/**
 * Split an `index.md` document into structured front-matter data and the Markdown
 * body. Front matter is tolerant (SPEC §5): whatever YAML is present is returned
 * as a plain object; a document with no front matter yields `data: {}`.
 */
export function parseFrontMatter(markdown: string): ParsedDocument {
  const tree = frontmatterParser.parse(markdown) as { children: unknown[] };
  const yamlNode = tree.children.find(isYamlNode);

  if (!yamlNode) {
    return { data: {}, body: markdown };
  }

  const parsed = parseYaml(yamlNode.value) as unknown;
  const data: FrontMatter =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as FrontMatter)
      : {};

  // Strip the front-matter block from the body using its source offset, then drop
  // the blank line(s) between the closing `---` and the body content.
  const endOffset = yamlNode.position?.end.offset ?? 0;
  const body = markdown.slice(endOffset).replace(/^(?:\r?\n)+/, '');

  return { data, body };
}
