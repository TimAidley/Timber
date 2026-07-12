import { SKIP, visit } from 'unist-util-visit';

/**
 * Render support for the `:::figure` image directive (SPEC §7). The editor owns the
 * authoring + byte-stable round-trip (`@timber/app`); this is the *build* half — it
 * turns the parsed directive into semantic `<figure>` markup. Kept here (not in the
 * app) because CI and the browser preview share this exact generator, so build ≡ preview.
 */
const FIGURE = 'figure';
const LAYOUTS = ['full-width', 'wrap-left', 'wrap-right', 'center'];
const SIZES = ['sm', 'md', 'lg'];
const DEFAULT_LAYOUT = 'full-width';
const DEFAULT_SIZE = 'md';

/** Minimal mdast shape this transform reads/writes (avoids a hard `@types/mdast` dep). */
interface MdNode {
  type: string;
  name?: string;
  value?: string;
  url?: string;
  alt?: string;
  attributes?: Record<string, string | null | undefined>;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  position?: { start: { offset?: number }; end: { offset?: number } };
}

function pick(value: unknown, allowed: string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function rawSource(node: MdNode, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start != null && end != null) return source.slice(start, end);
  return node.name ? `:${node.name}` : '';
}

/**
 * Rewrite a `figure` container directive into hast-bound mdast: the directive becomes
 * a `<figure>` with computed classes, holding the `<img>` (loading/decoding baked in)
 * and — if present — a `<figcaption>` for the caption content. Classes are computed
 * here so templates stay dumb (SPEC: compute in the generator, format in the template).
 */
function transformFigure(node: MdNode): void {
  const layout = pick(node.attributes?.layout, LAYOUTS, DEFAULT_LAYOUT);
  const size = pick(node.attributes?.size, SIZES, DEFAULT_SIZE);

  let image: MdNode | undefined;
  const caption: MdNode[] = [];
  for (const child of node.children ?? []) {
    const isImageParagraph =
      child.type === 'paragraph' &&
      child.children?.length === 1 &&
      child.children[0]?.type === 'image';
    if (!image && isImageParagraph) {
      image = child.children![0];
    } else if (child.type === 'paragraph') {
      caption.push(...(child.children ?? []));
    } else {
      caption.push(child);
    }
  }

  const children: MdNode[] = [];
  if (image) {
    image.data = {
      ...image.data,
      hProperties: { ...image.data?.hProperties, loading: 'lazy', decoding: 'async' },
    };
    children.push(image);
  }
  if (caption.length) {
    children.push({ type: 'paragraph', data: { hName: 'figcaption' }, children: caption });
  }

  node.children = children;
  node.data = {
    hName: 'figure',
    hProperties: { className: ['fig', `fig--${layout}`, `fig--${size}`] },
  };
}

/**
 * The remark transform. `figure` directives become `<figure>`; every OTHER directive
 * (stray `:x` / `::x` / `:::y`) is neutralised back to the plain text it was typed as,
 * mirroring the editor's sanitiser so hand-edited colon-bearing content renders as
 * written rather than as a half-parsed directive.
 */
export function remarkFigure() {
  return (tree: unknown, file: { toString(): string }): void => {
    const source = file.toString();
    visit(tree as never, (raw: unknown, index: number | undefined, rawParent: unknown) => {
      const node = raw as MdNode;
      const type = node.type;
      if (type !== 'textDirective' && type !== 'leafDirective' && type !== 'containerDirective') {
        return;
      }
      if (type === 'containerDirective' && node.name === FIGURE) {
        transformFigure(node);
        return;
      }
      const parent = rawParent as MdNode | undefined;
      if (!parent?.children || index == null) return;
      const text = rawSource(node, source);
      parent.children[index] =
        type === 'textDirective'
          ? { type: 'text', value: text }
          : { type: 'paragraph', children: [{ type: 'text', value: text }] };
      return [SKIP, index];
    });
  };
}
