import { parseEmbedUrl } from './embed.js';
import { escapeHtml } from './safeHtml.js';

/**
 * The embed **facade** (SPEC §7 → Embeds): a poster with a play control that becomes
 * the real iframe when someone asks for it. One emitter, so every route to an embed —
 * the `{% embed %}` tag today, the `:::embed` body directive next — produces the same
 * markup, and the injected script and styling (`embedAssets.ts`) only ever have one
 * shape to match.
 *
 * Why a facade and not a bare iframe: a page carrying a wasm game or a video player
 * would otherwise load that payload for every visitor who never clicks it.
 *
 * Both modes emit the **same anchor to the same URL**, which is what makes this
 * degrade honestly. `newtab` is finished markup — no script, and middle-click,
 * open-in-new-tab and keyboard activation all behave like the link it is. `inline`
 * is that anchor plus the data the script needs to swap in an iframe on click, so a
 * visitor with no JavaScript (or in the editor's script-stripped preview) still gets
 * the working link rather than a dead button.
 */
export interface EmbedSpec {
  /** The stored embed URL. Resolved here; an unusable URL emits nothing. */
  url: string;
  /** Poster image URL, as the template supplies it (bundle-relative is fine). */
  poster?: string;
  /** What the control is for, e.g. the page title. Becomes its accessible name. */
  label?: string;
  /** `inline` swaps in the iframe on click; `newtab` opens the URL in a new tab. */
  mode?: 'inline' | 'newtab';
  /** CSS `aspect-ratio` for the poster. Omit to let the poster image set its own. */
  ratio?: string;
  /** Maximum width for the poster, as a CSS length. Defaults to the column width. */
  width?: string;
  /**
   * `aspect-ratio` once the iframe is loaded. Defaults to {@link EmbedSpec.ratio}, or —
   * when that is the poster's own — to the shape the poster turned out to be.
   */
  frameRatio?: string;
  /** Maximum width once the iframe is loaded. Defaults to {@link EmbedSpec.width}. */
  frameWidth?: string;
}

/**
 * A CSS `aspect-ratio` value, kept to digits and a slash, and a CSS length, kept to a
 * number and a unit. Both reach the page through a `style` attribute, where escaping
 * alone would still let a value like `1;background:url(…)` add declarations of its own,
 * so the shape is checked rather than merely escaped. The two predicates are exported
 * because the content package validates these same attributes on a body block, and one
 * rule beats two copies that can disagree about what will actually render.
 */
const RATIO = /^\d+(\.\d+)?(\s*\/\s*\d+(\.\d+)?)?$/;
const LENGTH = /^\d+(\.\d+)?(px|rem|em|ch|%|vw|vh)$/;
const DEFAULT_RATIO = '16 / 9';

/** Whether a value is usable as an embed's `ratio` / `frameRatio`. */
export function isEmbedRatio(value: string): boolean {
  return RATIO.test(value.trim());
}

/** Whether a value is usable as an embed's `width` / `frameWidth`. */
export function isEmbedWidth(value: string): boolean {
  return LENGTH.test(value.trim());
}

/** Font Awesome Free's `play` (CC BY 4.0) — the same source as the default theme's icons. */
const PLAY_PATH =
  'M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9' +
  'L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.3-23-41L73 39z';

/**
 * One element of the facade, as a shape both output routes can build from: the
 * `{% embed %}` tag serialises it to HTML, and the `:::embed` directive maps it into
 * the Markdown pipeline's node tree. Describing the markup once is the point — two
 * emitters would be two things to keep in step with the injected script and styling.
 */
export interface EmbedElement {
  tag: string;
  /** Attributes in source order; `class` is the literal attribute, not `className`. */
  props: Record<string, string>;
  children: EmbedElement[];
}

function el(
  tag: string,
  props: Record<string, string | undefined>,
  children: EmbedElement[] = [],
): EmbedElement {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(props)) {
    if (value !== undefined) kept[name] = value;
  }
  return { tag, props: kept, children };
}

/**
 * The URL the iframe actually loads. A provider player is asked to start playing,
 * because the click that swapped it in *was* the play gesture and a facade that
 * resolves to a paused video has just added a second click. A direct embed is loaded
 * exactly as stored — someone's app is not ours to add query parameters to.
 */
function activationSrc(src: string, provider: string): string {
  if (provider === 'direct') return src;
  const url = new URL(src);
  url.searchParams.set('autoplay', '1');
  return url.toString();
}

/**
 * Build the facade for one embed, as an element tree. Returns `undefined` when the URL
 * can't be embedded — `embedUrlProblem` says why, and the validator has already reported
 * it, against the field or the body block it was written in, so the page is an
 * unpublishable draft rather than one silently missing markup.
 */
export function embedTree(spec: EmbedSpec): EmbedElement | undefined {
  const ref = parseEmbedUrl(spec.url);
  if (!ref) return undefined;

  const mode = spec.mode === 'newtab' ? 'newtab' : 'inline';
  // A value of the wrong shape falls back rather than failing the build: the validator
  // already reports it, and a page that lays out oddly beats a page that won't publish.
  const pick = (
    value: string | undefined,
    ok: (v: string) => boolean,
  ): string | undefined => (value && ok(value) ? value.trim() : undefined);
  // No ratio and a poster of your own means "this shape": the box takes the image's
  // own, rather than cropping it to a 16/9 letterbox. A *provider's* thumbnail is not
  // that — YouTube's is a 4:3 image with the video letterboxed inside it, so the
  // default crops the bars off, which is why it applies to a borrowed poster and an
  // embed with no poster at all (nothing to take a shape from).
  const ratio = pick(spec.ratio, isEmbedRatio) ?? (spec.poster ? 'auto' : DEFAULT_RATIO);
  const width = pick(spec.width, isEmbedWidth);
  // The poster and the iframe share one box, so "different settings for the two" is that
  // box being re-sized as the script swaps them. Only a *difference* is carried, so the
  // common case — one shape for both — emits nothing that would have to be undone.
  const frameRatio = pick(spec.frameRatio, isEmbedRatio);
  const frameWidth = pick(spec.frameWidth, isEmbedWidth);
  const poster = spec.poster ?? ref.poster;
  // The anchor carries the accessible name, so the poster is decorative — a described
  // image inside a described link is announced twice.
  const name = spec.label ? `Play ${spec.label}` : 'Play';

  const inner: EmbedElement[] = [];
  if (poster) {
    inner.push(
      el('img', {
        class: 'embed__poster',
        src: poster,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
      }),
    );
  }
  inner.push(
    el('span', { class: 'embed__play' }, [
      el(
        'svg',
        {
          class: 'embed__play-icon',
          viewBox: '0 0 384 512',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        [el('path', { d: PLAY_PATH })],
      ),
    ]),
  );

  const inline = mode === 'inline';
  return el(
    'div',
    {
      class: `embed embed--${mode}`,
      style: `--embed-ratio:${ratio}` + (width ? `;--embed-width:${width}` : ''),
      'data-embed-src': inline ? activationSrc(ref.src, ref.provider) : undefined,
      'data-embed-title': inline ? name : undefined,
      // Nothing when the frame matches the poster. With a poster-shaped box that
      // includes leaving it *unset*: the script measures the poster it is replacing, so
      // the swap keeps the shape the page was already laid out for.
      'data-embed-frame-ratio':
        inline && frameRatio && frameRatio !== ratio ? frameRatio : undefined,
      'data-embed-frame-width':
        inline && frameWidth && frameWidth !== width ? frameWidth : undefined,
    },
    [
      el(
        'a',
        {
          class: 'embed__launch',
          href: spec.url,
          target: '_blank',
          rel: 'noopener',
          'aria-label': name,
        },
        inner,
      ),
    ],
  );
}

/** Elements the facade uses that carry no children and close themselves. */
const SELF_CLOSING = new Set(['img', 'path']);

function serialize(node: EmbedElement): string {
  const attrs = Object.entries(node.props)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');
  if (SELF_CLOSING.has(node.tag) && node.children.length === 0) {
    return `<${node.tag}${attrs} />`;
  }
  return `<${node.tag}${attrs}>${node.children.map(serialize).join('')}</${node.tag}>`;
}

/**
 * The facade as an HTML string, for the `{% embed %}` tag — which writes it straight to
 * the output stream, so every value it carries is escaped here. Empty when the URL can't
 * be embedded; see {@link embedTree}.
 */
export function embedHtml(spec: EmbedSpec): string {
  const tree = embedTree(spec);
  return tree ? serialize(tree) : '';
}
