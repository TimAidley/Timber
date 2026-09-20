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
  /** CSS `aspect-ratio` for the frame. Defaults to 16 / 9. */
  ratio?: string;
}

/**
 * A CSS `aspect-ratio` value, kept to digits and a slash. The ratio reaches the page
 * through a `style` attribute, where escaping alone would still let a value like
 * `1;background:url(…)` add declarations of its own, so the shape is checked rather
 * than merely escaped.
 */
const RATIO = /^\d+(\.\d+)?(\s*\/\s*\d+(\.\d+)?)?$/;
const DEFAULT_RATIO = '16 / 9';

/** Font Awesome Free's `play` (CC BY 4.0) — the same source as the default theme's icons. */
const PLAY_ICON =
  '<svg class="embed__play-icon" viewBox="0 0 384 512" aria-hidden="true" focusable="false">' +
  '<path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.3-23-41L73 39z"/>' +
  '</svg>';

function attr(name: string, value: string | undefined): string {
  return value === undefined ? '' : ` ${name}="${escapeHtml(value)}"`;
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
 * Build the facade for one embed. Returns `''` when the URL can't be embedded —
 * `embedUrlProblem` says why, and the validator has already reported it against the
 * field, so the page is an unpublishable draft rather than one silently missing markup.
 */
export function embedHtml(spec: EmbedSpec): string {
  const ref = parseEmbedUrl(spec.url);
  if (!ref) return '';

  const mode = spec.mode === 'newtab' ? 'newtab' : 'inline';
  const ratio =
    spec.ratio && RATIO.test(spec.ratio.trim()) ? spec.ratio.trim() : DEFAULT_RATIO;
  const poster = spec.poster ?? ref.poster;
  // The anchor carries the accessible name, so the poster is decorative — a described
  // image inside a described link is announced twice.
  const name = spec.label ? `Play ${spec.label}` : 'Play';

  const inner = poster
    ? `<img class="embed__poster" src="${escapeHtml(poster)}" alt="" loading="lazy" decoding="async" />`
    : '';

  return (
    `<div class="embed embed--${mode}" style="--embed-ratio:${ratio}"` +
    (mode === 'inline'
      ? attr('data-embed-src', activationSrc(ref.src, ref.provider))
      : '') +
    (mode === 'inline' ? attr('data-embed-title', name) : '') +
    '>' +
    `<a class="embed__launch" href="${escapeHtml(spec.url)}" target="_blank" rel="noopener"` +
    attr('aria-label', name) +
    '>' +
    inner +
    `<span class="embed__play">${PLAY_ICON}</span>` +
    '</a>' +
    '</div>'
  );
}
