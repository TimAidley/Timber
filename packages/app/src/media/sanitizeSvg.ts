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
    USE_PROFILES: { svg: true },
    // The committed file is served as a standalone `image/svg+xml` document, which
    // the browser parses in XML mode. Sanitizing in the default `text/html` mode and
    // serving as XML is the classic mutation-XSS (mXSS) parser-differential: markup
    // the HTML parser folds into inert text can re-animate under the XML parser.
    // Parse in the same XML mode the file is served in so there is no differential.
    PARSER_MEDIA_TYPE: 'application/xhtml+xml',
    // A standalone SVG can fetch external resources via `href`/`xlink:href` and CSS
    // `url()` — a data-exfil / visitor-tracking channel even with scripts removed.
    // Forbid the elements whose only purpose is to pull in external content. (The
    // `svgFilters` profile is dropped for the same reason: `<feImage>` fetches URLs;
    // icon/logo SVGs don't need filter effects.)
    FORBID_TAGS: ['use', 'image', 'style'],
  });
}
