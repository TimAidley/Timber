/**
 * Video provider allowlist (SPEC §7): a `video` field stores just a URL; the tool
 * validates the host against an allowlist and extracts the id. The tool NEVER
 * accepts raw embed HTML (XSS). Iframe construction from the id is a template/render
 * concern (Phase 6+); this module only covers validation + id extraction.
 */
export interface VideoRef {
  provider: 'youtube' | 'vimeo';
  id: string;
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const YOUTUBE_SHORT_HOSTS = new Set(['youtu.be']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

/**
 * Parse a video URL against the provider allowlist. Returns the provider + id, or
 * `undefined` if the URL is malformed or the host is not allow-listed.
 */
export function parseVideoUrl(url: string): VideoRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;

  const host = parsed.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host)) {
    const id = parsed.searchParams.get('v');
    return id ? { provider: 'youtube', id } : undefined;
  }
  if (YOUTUBE_SHORT_HOSTS.has(host)) {
    const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
    return id ? { provider: 'youtube', id } : undefined;
  }
  if (VIMEO_HOSTS.has(host)) {
    const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
    return id && /^\d+$/.test(id) ? { provider: 'vimeo', id } : undefined;
  }

  return undefined;
}
