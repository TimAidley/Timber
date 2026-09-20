import { SKIP, visit } from 'unist-util-visit';
import { embedTree, type EmbedElement, type EmbedSpec } from './embedMarkup.js';

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

/**
 * The brand-wordmark shortcode (SPEC §7 → Brand wordmark). An inline `:timber-logo`
 * directive renders the exact "Timber" wordmark used in the editor header — the same
 * `<span class="wordmark"><span class="wordmark__tim">Tim</span>ber</span>` markup,
 * styled by the theme's `.wordmark` rules + the vendored Fraunces face.
 */
const WORDMARK = 'timber-logo';

/**
 * The `:::embed` directive (SPEC §7 → Embeds) — the body counterpart of the
 * `{% embed %}` tag, for a game or a video that belongs *in* an article rather than
 * at a slot the theme chose:
 *
 *     ::embed{url="https://tim.aidley.com/redbaron/" poster="game.webp" label="Red Baron"}
 *
 * Both routes go through `embedTree`, so a body embed and a template one are the same
 * component — which is what lets one injected script and one stylesheet serve both.
 */
const EMBED = 'embed';

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
    children.push({
      type: 'paragraph',
      data: { hName: 'figcaption' },
      children: caption,
    });
  }

  node.children = children;
  node.data = {
    hName: 'figure',
    hProperties: { className: ['fig', `fig--${layout}`, `fig--${size}`] },
  };
}

/**
 * Rewrite a `timber-logo` text/leaf directive into the brand wordmark: two nested
 * spans mirroring the editor's `<Wordmark />` component exactly — outer `.wordmark`
 * holds "ber", inner `.wordmark__tim` holds "Tim". Classes only; the theme owns the
 * font + weights (SPEC: compute in the generator, format in the template). Any body
 * the author typed after the directive is discarded — the wordmark is fixed text.
 */
function transformWordmark(node: MdNode): void {
  node.children = [
    {
      type: 'wordmarkTim',
      data: { hName: 'span', hProperties: { className: ['wordmark__tim'] } },
      children: [{ type: 'text', value: 'Tim' }],
    },
    { type: 'text', value: 'ber' },
  ];
  node.data = { hName: 'span', hProperties: { className: ['wordmark'] } };
}

/**
 * Map the facade's element tree into mdast, the way `transformWordmark` does: nodes of
 * a type remark-rehype doesn't know, carrying `hName`/`hProperties`, which it turns into
 * exactly those elements. `class` becomes `className` here — the one place the two
 * spellings meet — and the sanitiser's schema (`markdown.ts`) is what decides that these
 * particular elements and attributes survive.
 */
function toMdast(node: EmbedElement): MdNode {
  const { class: className, ...rest } = node.props;
  return {
    type: 'embedElement',
    data: {
      hName: node.tag,
      hProperties: {
        ...(className !== undefined ? { className: className.split(' ') } : {}),
        ...rest,
      },
    },
    children: node.children.map(toMdast),
  };
}

/**
 * Rewrite an `embed` directive into the facade, reporting whether it could. A URL that
 * can't be embedded leaves the node alone, so it neutralises to the source the author
 * typed like any other directive this transform doesn't take — the same "shown as
 * written" outcome, and the validator (`validateEmbedBlocks`) names the problem. Any
 * body typed inside the container form is discarded, as it is for the wordmark: an
 * embed is its attributes.
 */
function transformEmbed(node: MdNode): boolean {
  const attributes = node.attributes ?? {};
  if (!attributes.url) return false;
  const tree = embedTree(attributes as unknown as EmbedSpec);
  if (!tree) return false;

  const mapped = toMdast(tree);
  node.children = mapped.children ?? [];
  node.data = mapped.data ?? {};
  return true;
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
    visit(
      tree as never,
      (raw: unknown, index: number | undefined, rawParent: unknown) => {
        const node = raw as MdNode;
        const type = node.type;
        if (
          type !== 'textDirective' &&
          type !== 'leafDirective' &&
          type !== 'containerDirective'
        ) {
          return;
        }
        if (type === 'containerDirective' && node.name === FIGURE) {
          transformFigure(node);
          return;
        }
        if (
          (type === 'textDirective' || type === 'leafDirective') &&
          node.name === WORDMARK
        ) {
          transformWordmark(node);
          return;
        }
        // Both block forms, because `::embed{…}` and `:::embed{…}` are equally natural to
        // type and the difference (a closing fence) buys an embed nothing. An embed that
        // can't be resolved falls through to the neutralising branch below.
        if (
          (type === 'leafDirective' || type === 'containerDirective') &&
          node.name === EMBED &&
          transformEmbed(node)
        ) {
          return SKIP;
        }
        const parent = rawParent as MdNode | undefined;
        if (!parent?.children || index == null) return;
        const text = rawSource(node, source);
        parent.children[index] =
          type === 'textDirective'
            ? { type: 'text', value: text }
            : { type: 'paragraph', children: [{ type: 'text', value: text }] };
        return [SKIP, index];
      },
    );
  };
}
