/**
 * Upload policy for **site-wide assets** under `/assets` (SPEC §7/§13). Content-object
 * images already flow through {@link ./processImage} into a bundle; this is the counterpart
 * for the theme's shared assets — fonts, logos, favicons — which the editor couldn't manage
 * before. The set of acceptable uploads is a **curated allowlist** (a locked decision): the
 * in-browser image pipeline for raster/vector images, byte-for-byte passthrough for a small
 * set of known-safe binaries, and everything else rejected.
 *
 * Classification is by **file extension**, deliberately — it's what the committed path and
 * the served site rely on (static Pages hosts serve by extension), and it's stabler than a
 * browser-supplied MIME (which is often empty or wrong for fonts). Kept pure (no DOM, no
 * I/O) so the whole policy is unit-testable, mirroring `plan.ts`.
 */

/** Generous ceiling on a single asset — a self-hosted font or hero image sits well under
 *  this; the cap only stops an accidental multi-megabyte commit. */
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;

/** Extensions routed through the image pipeline (resize/re-encode to WebP, sanitize SVG,
 *  pass animated GIF) — see {@link ./plan}. `.ico` is intentionally NOT here: a favicon
 *  must stay an icon, and canvas re-encoding would destroy it (it's a passthrough below). */
const PIPELINE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg']);

/** Extensions committed verbatim, with the MIME the built site should serve them as. */
const PASSTHROUGH_MIME: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
};

/** What to do with an uploaded site asset. */
export type UploadDecision =
  | { action: 'process' }
  | { action: 'passthrough'; mime: string }
  | { action: 'reject'; reason: string };

/** Lower-cased extension without the dot (`Logo.WOFF2` → `woff2`), or '' if none. */
export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The allowed extensions, for a human-readable rejection hint. */
export const ALLOWED_EXTS: readonly string[] = [
  ...PIPELINE_EXTS,
  ...Object.keys(PASSTHROUGH_MIME),
];

/**
 * Decide how to handle a site-asset upload from its name + size. Size is checked first
 * (an over-cap file is rejected whatever its type), then the extension is matched against
 * the allowlist: image → the pipeline, known binary → passthrough, anything else → reject.
 */
export function classifyUpload(name: string, size: number): UploadDecision {
  if (size > MAX_ASSET_BYTES) {
    return {
      action: 'reject',
      reason: `Too large (${formatBytes(size)}). The limit is ${formatBytes(MAX_ASSET_BYTES)}.`,
    };
  }
  const ext = extensionOf(name);
  if (PIPELINE_EXTS.has(ext)) return { action: 'process' };
  const mime = PASSTHROUGH_MIME[ext];
  if (mime) return { action: 'passthrough', mime };
  return {
    action: 'reject',
    reason: ext
      ? `.${ext} files aren't allowed. Allowed: ${ALLOWED_EXTS.join(', ')}.`
      : `Files need an extension. Allowed: ${ALLOWED_EXTS.join(', ')}.`,
  };
}
