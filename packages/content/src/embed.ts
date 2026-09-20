/**
 * Embed URL resolution (SPEC §7): an `embed` field stores just a URL; this module
 * turns that URL into the `src` an iframe can carry. The tool NEVER accepts raw
 * embed HTML (XSS) — the URL is the whole stored value, and markup is built from
 * the resolved ref downstream.
 *
 * The provider list is a **rewriter, not a gate**. A YouTube or Vimeo link names a
 * video rather than an embeddable page, so it is translated into that provider's
 * player URL; any other https URL is embeddable as itself (a WebAssembly game, a
 * map, a notebook) and passes through untouched. Framing a third-party URL is not
 * an XSS vector — an iframe is a separate browsing context — so there is nothing
 * for an allowlist to defend here. What the parse does enforce is https (an http
 * embed is mixed content on an HTTPS site) and, for a provider link, that we could
 * actually extract a video id: falling back to embedding a `watch?v=` URL would
 * produce a frame the provider refuses to render.
 */
export type EmbedProvider = 'youtube' | 'vimeo' | 'direct';

export interface EmbedRef {
  provider: EmbedProvider;
  /** Provider-assigned video id. Absent for `direct`, where the URL is the embed. */
  id?: string;
  /** The URL to put in an iframe's `src`. */
  src: string;
  /** A poster image, where the provider exposes one at a stable URL. */
  poster?: string;
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const YOUTUBE_SHORT_HOSTS = new Set(['youtu.be']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

// A YouTube video id is exactly 11 chars of `[A-Za-z0-9_-]`. Validating it here — the
// sanitization boundary — means a template can interpolate the id into an embed URL
// without an id like `"><script>` breaking out (searchParams/pathname are URL-decoded,
// so an un-checked id can carry arbitrary characters). Mirrors the Vimeo `^\d+$` guard.
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The path segments after a provider's own prefix (`/embed/ID`, `/video/ID`). */
function segments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

/**
 * A YouTube id can arrive four ways: `watch?v=ID`, `youtu.be/ID`, `embed/ID` (what
 * the provider's own share dialog hands out) and `shorts/ID`.
 */
function youtubeId(parsed: URL): string | undefined {
  if (YOUTUBE_SHORT_HOSTS.has(parsed.hostname.toLowerCase()))
    return segments(parsed.pathname)[0];
  const fromQuery = parsed.searchParams.get('v');
  if (fromQuery) return fromQuery;
  const parts = segments(parsed.pathname);
  if (parts.length === 2 && (parts[0] === 'embed' || parts[0] === 'shorts'))
    return parts[1];
  return undefined;
}

/** `vimeo.com/ID` and the player form `player.vimeo.com/video/ID`. */
function vimeoId(parsed: URL): string | undefined {
  const parts = segments(parsed.pathname);
  if (parts.length >= 2 && parts[0] === 'video') return parts[1];
  return parts[0];
}

type Parsed = { ref: EmbedRef } | { problem: string };

function parse(url: string): Parsed {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { problem: 'is not a URL' };
  }

  // https only: a stored `http:` embed downgrades to mixed content on the HTTPS site.
  if (parsed.protocol !== 'https:') {
    return {
      problem: 'must be an https:// URL — an http:// embed is blocked as mixed content',
    };
  }

  const host = parsed.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host) || YOUTUBE_SHORT_HOSTS.has(host)) {
    const id = youtubeId(parsed);
    if (!id || !YOUTUBE_ID.test(id))
      return { problem: 'is a YouTube link but names no video' };
    return {
      ref: {
        provider: 'youtube',
        id,
        // The no-cookie host is YouTube's own embed domain and sets no tracking cookie
        // until playback starts — the polite default for a site that can't ask consent.
        src: `https://www.youtube-nocookie.com/embed/${id}`,
        poster: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      },
    };
  }

  if (VIMEO_HOSTS.has(host)) {
    const id = vimeoId(parsed);
    if (!id || !/^\d+$/.test(id))
      return { problem: 'is a Vimeo link but names no video' };
    return {
      ref: { provider: 'vimeo', id, src: `https://player.vimeo.com/video/${id}` },
    };
  }

  // Anything else embeds as itself. `toString()` rather than the raw input so the src
  // is a normalised URL built by the parser, not a string we merely looked at.
  return { ref: { provider: 'direct', src: parsed.toString() } };
}

/**
 * Resolve an embed URL to the ref a template renders from, or `undefined` if the URL
 * can't be embedded. {@link embedUrlProblem} explains why, in the same words the
 * validator and the editor widget use.
 */
export function parseEmbedUrl(url: string): EmbedRef | undefined {
  const result = parse(url);
  return 'ref' in result ? result.ref : undefined;
}

/**
 * Why {@link parseEmbedUrl} rejected a URL, as a phrase that completes
 * `embed URL "…" <problem>`. `undefined` when the URL is fine.
 */
export function embedUrlProblem(url: string): string | undefined {
  const result = parse(url);
  return 'ref' in result ? undefined : result.problem;
}
