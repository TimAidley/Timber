import { jekyllEngine, type ThemeEngine, type ThemeFiles } from '@timber/jekyll-compat';
import { eleventyEngine } from './engine.js';

/**
 * Pick the source-system engine for an uploaded/read theme (SPEC §2 → Tier A). A `_layouts/`
 * folder of `.html` layouts is the Jekyll signature; `.liquid` templates under `_includes/`
 * (at any input-dir prefix) — or an Eleventy config file — signal Eleventy. Ambiguous themes
 * default to Jekyll (the original path). The import UI/CLI lets the user override this.
 */
export function detectEngine(theme: ThemeFiles): ThemeEngine {
  const paths = Object.keys(theme.text);
  if (paths.some((p) => /(^|\/)_layouts\/[^/]+\.html$/.test(p))) return jekyllEngine;
  const looksEleventy =
    paths.some((p) => /(^|\/)_includes\/.+\.liquid$/.test(p)) ||
    paths.some((p) => /(^|\/)(\.eleventy|eleventy\.config)\.(c?js|mjs)$/.test(p));
  return looksEleventy ? eleventyEngine : jekyllEngine;
}

/** Map an explicit engine name (`jekyll`/`eleventy`) to its engine; unknown → Jekyll. */
export function engineByName(name: string | undefined): ThemeEngine {
  return name === 'eleventy' ? eleventyEngine : jekyllEngine;
}

/** The runtime id an engine writes to its manifest (`eleventy`, or `jekyll` for the native one). */
export function engineName(engine: ThemeEngine): 'jekyll' | 'eleventy' {
  return engine === eleventyEngine ? 'eleventy' : 'jekyll';
}
