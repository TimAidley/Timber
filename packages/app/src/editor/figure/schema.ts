import { $nodeSchema } from '@milkdown/kit/utils';
import type { MarkdownNode } from '@milkdown/kit/transformer';
import { FIGURE_DIRECTIVE } from './remark.js';

/** Bounded layout choices (SPEC §7). `full-width` is the default and is column-wide. */
export const FIGURE_LAYOUTS = ['full-width', 'wrap-left', 'wrap-right', 'center'] as const;
/** Bounded size buckets; only meaningful for wrap/centre layouts. `md` is the default. */
export const FIGURE_SIZES = ['sm', 'md', 'lg'] as const;

export type FigureLayout = (typeof FIGURE_LAYOUTS)[number];
export type FigureSize = (typeof FIGURE_SIZES)[number];

export const DEFAULT_LAYOUT: FigureLayout = 'full-width';
export const DEFAULT_SIZE: FigureSize = 'md';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Clamp a stored/authored value to the allowlist, falling back to the default. */
export function normalizeLayout(value: unknown): FigureLayout {
  return (FIGURE_LAYOUTS as readonly string[]).includes(asString(value))
    ? (value as FigureLayout)
    : DEFAULT_LAYOUT;
}

export function normalizeSize(value: unknown): FigureSize {
  return (FIGURE_SIZES as readonly string[]).includes(asString(value))
    ? (value as FigureSize)
    : DEFAULT_SIZE;
}

function isBareImageParagraph(node: MarkdownNode): boolean {
  return (
    node.type === 'paragraph' &&
    node.children?.length === 1 &&
    node.children[0]?.type === 'image'
  );
}

/**
 * The `figure` node (SPEC §7). A block node whose **attributes** carry the image
 * (`src`/`alt`) and layout (`layout`/`size`), and whose **content** is the caption —
 * real editable inline Markdown, so a `<figcaption>` can hold emphasis or a credit
 * link. The image is attrs (identity data drawn by the NodeView), not editor content;
 * only the caption is a content hole.
 *
 * On disk it is a `:::figure` container directive (see {@link figureRemark}), EXCEPT
 * the canonical trivial case — `full-width`, default size, no caption — which
 * serialises to a **bare `![alt](src)`** so plain images never inflate into a
 * directive and stay byte-stable.
 */
export const figureSchema = $nodeSchema(FIGURE_DIRECTIVE, () => ({
  group: 'block',
  content: 'inline*',
  defining: true,
  isolating: true,
  atom: false,
  attrs: {
    layout: { default: DEFAULT_LAYOUT },
    size: { default: DEFAULT_SIZE },
    src: { default: '' },
    alt: { default: '' },
  },
  parseDOM: [
    {
      tag: 'figure[data-figure]',
      contentElement: 'figcaption',
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) return false;
        const img = dom.querySelector('img');
        return {
          layout: normalizeLayout(dom.getAttribute('data-layout')),
          size: normalizeSize(dom.getAttribute('data-size')),
          src: img?.getAttribute('src') ?? '',
          alt: img?.getAttribute('alt') ?? '',
        };
      },
    },
  ],
  toDOM: (node) => {
    const { layout, size, src, alt } = node.attrs;
    return [
      'figure',
      {
        'data-figure': '',
        'data-layout': layout,
        'data-size': size,
        class: `fig fig--${layout} fig--${size}`,
      },
      ['img', { src, alt, draggable: 'false' }],
      ['figcaption', 0],
    ];
  },
  parseMarkdown: {
    match: (node) => node.type === 'containerDirective' && node.name === FIGURE_DIRECTIVE,
    runner: (state, node, type) => {
      const attributes = (node.attributes ?? {}) as Record<string, unknown>;
      let src = '';
      let alt = '';
      const caption: MarkdownNode[] = [];
      for (const child of node.children ?? []) {
        const image = isBareImageParagraph(child) ? child.children?.[0] : undefined;
        if (!src && image) {
          src = asString(image.url);
          alt = asString(image.alt);
        } else if (child.type === 'paragraph') {
          caption.push(...(child.children ?? []));
        } else {
          caption.push(child);
        }
      }
      state.openNode(type, {
        layout: normalizeLayout(attributes.layout),
        size: normalizeSize(attributes.size),
        src,
        alt,
      });
      if (caption.length) state.next(caption);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === FIGURE_DIRECTIVE,
    runner: (state, node) => {
      const layout = normalizeLayout(node.attrs.layout);
      const size = normalizeSize(node.attrs.size);
      const src = asString(node.attrs.src);
      const alt = asString(node.attrs.alt);
      const hasCaption = node.content.size > 0;

      const emitImageParagraph = (): void => {
        state.openNode('paragraph');
        state.addNode('image', undefined, undefined, { url: src, alt });
        state.closeNode();
      };

      // Canonical trivial case → bare image, byte-identical to the commonmark image node.
      if (layout === DEFAULT_LAYOUT && size === DEFAULT_SIZE && !hasCaption) {
        emitImageParagraph();
        return;
      }

      // Non-default attributes only, in fixed order (layout, then size). Empty → `:::figure`.
      const attributes: Record<string, string> = {};
      if (layout !== DEFAULT_LAYOUT) attributes.layout = layout;
      if (size !== DEFAULT_SIZE) attributes.size = size;

      state.openNode('containerDirective', undefined, {
        name: FIGURE_DIRECTIVE,
        attributes,
      });
      emitImageParagraph();
      if (hasCaption) {
        state.openNode('paragraph');
        state.next(node.content);
        state.closeNode();
      }
      state.closeNode();
    },
  },
}));
