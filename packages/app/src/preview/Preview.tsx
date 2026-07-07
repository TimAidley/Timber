import { sanitizePreviewHtml } from './sanitizePreview.js';

interface PreviewProps {
  html: string;
  error: string | null;
}

/**
 * Presentational preview pane: shows pre-rendered HTML (or the render error). The
 * actual generator render lives in {@link useRenderedPreview} so the same output can
 * also drive a popped-out preview window — see SPEC §6, §12 ("the browser validates").
 *
 * The rendered HTML is injected into the app's own DOM, which is the SAME origin as
 * the GitHub token store. Content is author-supplied (front matter, body), so it is
 * sanitized with DOMPurify first: without this, a front-matter value like
 * `poster: 'x" onerror="…"'` would fire an event handler in the token-holding origin.
 * Defense-in-depth on top of the generator's Liquid auto-escaping.
 */
export function Preview({ html, error }: PreviewProps): React.JSX.Element {
  if (error) {
    return <pre className="preview preview--error">{error}</pre>;
  }
  const safe = sanitizePreviewHtml(html);
  return <div className="preview" dangerouslySetInnerHTML={{ __html: safe }} />;
}
