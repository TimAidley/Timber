import { useEffect, useState } from 'react';
import { renderPage, type FrontMatter } from '@timber/generator';
import { reassembleDocument } from '../content/document.js';
import { defaultTemplate } from '../state/defaultTemplate.js';

interface PreviewProps {
  data: FrontMatter;
  body: string;
}

/**
 * Live preview: reassemble the current front matter + body into an `index.md` and
 * render it through the generator's `renderPage` — the exact function CI runs, so
 * what you see is what the build produces (SPEC §6, §12: "the browser validates").
 * Rendering is async (the remark→Liquid pipeline), so it runs in an effect.
 */
export function Preview({ data, body }: PreviewProps): React.JSX.Element {
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const raw = reassembleDocument(data, body);
    renderPage({ markdown: raw, template: defaultTemplate })
      .then((out) => {
        if (!cancelled) {
          setHtml(out);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [data, body]);

  if (error) {
    return <pre className="preview preview--error">{error}</pre>;
  }
  return <div className="preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
