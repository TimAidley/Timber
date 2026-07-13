import { useEffect, useState } from 'react';
import type { FrontMatter } from '@timber/generator';
import type { ContentModel, ContentObject, ContentTypeSchema } from '@timber/content';
import { renderSitePage } from './renderSitePage.js';
import type { AssetStore } from '../state/assets.js';
import type { SiteTheme } from './siteTheme.js';

/**
 * Render the currently edited page through the site's own template + theme, yielding a
 * full HTML document for the preview frame (SPEC §6/§13). Runs the same `renderPage` the
 * CI build runs (via {@link renderSitePage}), so what you see is what the build produces.
 * The same document also feeds the popped-out preview window without rendering twice.
 *
 * Gated by `enabled` (skip when no preview surface is visible) and by the theme having
 * loaded and an object being selected; otherwise it holds the last render.
 */
export function useRenderedPreview(
  model: ContentModel,
  object: ContentObject | undefined,
  schema: ContentTypeSchema | undefined,
  data: FrontMatter,
  body: string,
  theme: SiteTheme | null,
  assetStore: AssetStore,
  enabled = true,
): { html: string; error: string | null } {
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !theme || !object || !schema) return;
    let cancelled = false;
    renderSitePage({ model, object, schema, data, body, theme, assetStore })
      .then((out) => {
        if (cancelled) return;
        setHtml(out);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [model, object, schema, data, body, theme, assetStore, enabled]);

  return { html, error };
}
