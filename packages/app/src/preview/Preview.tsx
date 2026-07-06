interface PreviewProps {
  html: string;
  error: string | null;
}

/**
 * Presentational preview pane: shows pre-rendered HTML (or the render error). The
 * actual generator render lives in {@link useRenderedPreview} so the same output can
 * also drive a popped-out preview window — see SPEC §6, §12 ("the browser validates").
 */
export function Preview({ html, error }: PreviewProps): React.JSX.Element {
  if (error) {
    return <pre className="preview preview--error">{error}</pre>;
  }
  return <div className="preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
