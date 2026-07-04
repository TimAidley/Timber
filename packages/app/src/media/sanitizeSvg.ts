import DOMPurify from 'dompurify';

/**
 * Sanitize an uploaded SVG before it is ever staged or committed (SPEC §7): SVG is
 * XML and can carry `<script>`, `onload=`/`onclick=` handlers, and
 * `href="javascript:…"` — a stored-XSS vector. DOMPurify (DOM-only, zero native
 * deps) strips all of that while keeping legitimate vector content.
 *
 * Runs on the main thread, not in the pipeline's Web Worker, because DOMPurify
 * needs a DOM (workers have none); the heavy raster re-encode is what goes to the
 * worker instead.
 */
export function sanitizeSvg(source: string): string {
  return DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}
