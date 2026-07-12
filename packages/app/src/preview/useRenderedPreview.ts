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
      .then(async (out) => {
        if (cancelled) return;
        // Images live in the repo, not on a server the preview can reach, so their
        // bundle paths are rewritten to in-app object URLs. Ensure any committed image
        // the page references is loaded first (a reload empties the in-memory store),
        // then swap every staged/loaded asset path.
        const referenced = [...out.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map((m) => m[1])
          .filter((p): p is string => !!p && !/^(?:[a-z]+:|\/\/|#)/i.test(p));
        await Promise.all([...new Set(referenced)].map((p) => assetStore.ensure(p)));
        if (cancelled) return;
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
