import { useEffect, useState } from 'react';
import { renderPage, type FrontMatter } from '@timber/generator';
import { reassembleDocument } from '../content/document.js';
import { defaultTemplate } from '../state/defaultTemplate.js';
import type { AssetStore } from '../state/assets.js';

/**
 * Render the current front matter + body through the generator's `renderPage` — the
 * exact function CI runs, so what you see is what the build produces (SPEC §6, §12).
 * Extracted from the preview pane so the *same* rendered HTML can also feed a
 * popped-out preview window without rendering twice.
 *
 * `enabled` gates the (async) render: when no preview surface is visible or popped
 * out, skip the work entirely.
 */
export function useRenderedPreview(
  data: FrontMatter,
  body: string,
  assetStore: AssetStore,
  enabled = true,
): { html: string; error: string | null } {
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const raw = reassembleDocument(data, body);
    renderPage({ markdown: raw, template: defaultTemplate })
      .then((out) => {
        if (cancelled) return;
        // Staged images aren't on a server yet (Phase 5 commits them), so rewrite
        // their bundle paths to object URLs so the preview <img> resolves in-app.
        let resolved = out;
        for (const asset of assetStore.all()) {
          resolved = resolved.split(asset.path).join(asset.url);
        }
        setHtml(resolved);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [data, body, assetStore, enabled]);

  return { html, error };
}
