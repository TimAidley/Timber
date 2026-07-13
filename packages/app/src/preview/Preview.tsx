interface PreviewProps {
  html: string;
  error: string | null;
}

/**
 * Presentational preview pane: renders the full page document (the site's own template +
 * theme) produced by {@link useRenderedPreview}, so the preview looks like the built page
 * rather than editor chrome (SPEC §6/§13).
 *
 * It renders in an iframe rather than inline, both to isolate the site theme's CSS from
 * the editor and to protect the GitHub token: the app origin holds the token, so the
 * frame is sandboxed WITHOUT `allow-scripts` — no script (or inline handler) in the
 * rendered page can execute, so it can never reach `window.parent` or the token store.
 * `allow-same-origin` is kept (without `allow-scripts` it grants no scripting power) so
 * the frame can load the `blob:` object URLs the render mints for images and theme fonts.
 */
export function Preview({ html, error }: PreviewProps): React.JSX.Element {
  if (error) {
    return <pre className="preview preview--error">{error}</pre>;
  }
  return (
    <iframe
      className="preview-frame"
      title="Page preview"
      sandbox="allow-same-origin"
      srcDoc={html}
    />
  );
}
