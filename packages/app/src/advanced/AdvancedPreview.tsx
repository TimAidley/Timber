import { useEffect, useMemo, useState } from 'react';
import { renderPage, type FrontMatter, type TemplateMap } from '@timber/generator';
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

/** The advanced work area's preview pane: a live template render for `.liquid` files, a
 * style specimen for `.css` files, a note for config (validated on edit, not previewed). */
export function AdvancedPreview({
  session,
  kind,
  template,
  templates,
  valid,
}: {
  session: RepoSession;
  kind: AdvancedKind;
  template: string;
  /** The site's other templates (bare-name keyed), so a `{% layout %}`ing template can
   *  resolve its base while it's being edited (SPEC §6). */
  templates?: TemplateMap | undefined;
  valid: boolean;
}): React.JSX.Element {
  if (kind === 'style') return <StylePreview css={template} />;
  if (kind !== 'template') {
    return (
      <p className="app__preview-empty">
        Preview shows for templates and styles. Config is validated on edit.
      </p>
    );
  }
  return (
    <TemplatePreview
      session={session}
      template={template}
      templates={templates}
      valid={valid}
    />
  );
}

/**
 * A representative page skeleton — the default theme's own markup + class names
 * (`.site-header`, `.page`, a heading/paragraph/link, a code block, the footer) — with
 * the *edited* CSS applied live in a sandboxed frame. It shows what the stylesheet does
 * to real theme selectors without needing to load templates or content into this pane.
 * `url(fonts/…)` refs don't resolve here (they'd need the repo-blob rewriting the main
 * site preview does), so self-hosted fonts fall back — colour/spacing/type still show.
 */
function stylePreviewDoc(css: string): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8" />',
    `<style>${css}</style></head><body>`,
    '<header class="site-header">',
    '<a class="site-title" href="#">Site title</a>',
    '<nav class="site-nav"><a href="#">Home</a><a href="#">About</a></nav>',
    '</header>',
    '<main class="site-main"><article class="page">',
    '<h1>A specimen heading</h1>',
    '<p>Body copy with a <a href="#">link</a> and <code>inline code</code>, so you can',
    ' check colours, spacing and type against the theme’s selectors.</p>',
    '<pre><code>const example = "code block";</code></pre>',
    '</article></main>',
    '<footer class="site-footer"><p>© Site title — a tagline</p></footer>',
    '</body></html>',
  ].join('');
}

/** Render the style specimen. The frame is `allow-scripts`-free (no scripts to run) and
 * has an opaque origin, so the edited CSS can't reach this token-holding app. */
function StylePreview({ css }: { css: string }): React.JSX.Element {
  const doc = useMemo(() => stylePreviewDoc(css), [css]);
  return (
    <iframe className="advanced__frame" title="Style specimen" sandbox="" srcDoc={doc} />
  );
}

/** Render a sample content object through the *edited* template — the live half of
 * the advanced edit-preview loop. Only renders when the template parses (an invalid
 * template would throw); otherwise the validation banner already explains the block. */
function TemplatePreview({
  session,
  template,
  templates,
  valid,
}: {
  session: RepoSession;
  template: string;
  templates?: TemplateMap | undefined;
  valid: boolean;
}): React.JSX.Element {
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ctx = useMemo(() => sampleRender(session), [session]);

  useEffect(() => {
    if (!valid || !ctx) return;
    let cancelled = false;
    renderPage({
      markdown: ctx.markdown,
      template,
      templates,
      site: ctx.site,
      seo: ctx.seo,
    })
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
  }, [template, templates, valid, ctx]);

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
