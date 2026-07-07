import { useEffect, useMemo, useState } from 'react';
import { renderPage, type FrontMatter } from '@timber/generator';
import {
  siteContext,
  pageSeo,
  type ContentObject,
  type SiteContext,
  type PageSeo,
} from '@timber/content';
import type { RepoSession } from '../state/repoSession.js';
import { reassembleDocument } from '../content/document.js';
import type { AdvancedKind } from './loadAdvancedFiles.js';

/** Build the `{ markdown, site, seo }` context for previewing a template against a
 * real content object — the same derivation the CLI build uses, so the preview
 * reflects production. Returns null if the repo has no renderable page object. */
function sampleRender(
  session: RepoSession,
): { markdown: string; site: SiteContext; seo: PageSeo } | null {
  const { model } = session;
  const settings = model.objects.find((o) => model.schemas.get(o.type)?.page === false);
  const site = siteContext(settings);
  const sample: ContentObject | undefined = model.objects.find(
    (o) => model.schemas.get(o.type)?.page !== false,
  );
  if (!sample) return null;
  const schema = model.schemas.get(sample.type);
  if (!schema) return null;
  return {
    markdown: reassembleDocument(sample.data as FrontMatter, sample.body),
    site,
    seo: pageSeo(sample, schema, site),
  };
}

/** The advanced work area's preview pane: a live template render for `.liquid` files,
 * a note for config (which is validated on edit, not previewed). */
export function AdvancedPreview({
  session,
  kind,
  template,
  valid,
}: {
  session: RepoSession;
  kind: AdvancedKind;
  template: string;
  valid: boolean;
}): React.JSX.Element {
  if (kind !== 'template') {
    return (
      <p className="app__preview-empty">
        Preview shows for templates. Config is validated on edit.
      </p>
    );
  }
  return <TemplatePreview session={session} template={template} valid={valid} />;
}

/** Render a sample content object through the *edited* template — the live half of
 * the advanced edit-preview loop. Only renders when the template parses (an invalid
 * template would throw); otherwise the validation banner already explains the block. */
function TemplatePreview({
  session,
  template,
  valid,
}: {
  session: RepoSession;
  template: string;
  valid: boolean;
}): React.JSX.Element {
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ctx = useMemo(() => sampleRender(session), [session]);

  useEffect(() => {
    if (!valid || !ctx) return;
    let cancelled = false;
    renderPage({ markdown: ctx.markdown, template, site: ctx.site, seo: ctx.seo })
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
  }, [template, valid, ctx]);

  if (!ctx)
    return <p className="app__preview-empty">No content object to preview against.</p>;
  if (!valid)
    return <p className="app__preview-empty">Fix the template to see the preview.</p>;
  if (error) return <pre className="preview preview--error">{error}</pre>;
  // A `srcDoc` iframe is `about:srcdoc` — SAME-ORIGIN with this token-holding app,
  // and scripts in it run — so an edited/loaded template containing `<script>` could
  // reach `window.parent` and the GitHub token. `sandbox="allow-scripts"` (WITHOUT
  // `allow-same-origin`) gives the frame an opaque origin: template scripts still run
  // for preview fidelity, but can't touch this app's origin or its storage.
  return (
    <iframe
      className="advanced__frame"
      title="Template preview"
      sandbox="allow-scripts"
      srcDoc={html}
    />
  );
}
