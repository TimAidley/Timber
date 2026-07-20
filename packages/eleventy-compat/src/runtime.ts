import type { Liquid } from 'liquidjs';
import { registerJekyllCompat } from '@timber/jekyll-compat';
import { registerEleventyCompat } from './register.js';

/**
 * The per-theme render runtime (SPEC §2 → Tier A). A theme's `themes/<name>/theme.json`
 * manifest (written by the import for a non-native engine) tells the build and the preview how
 * to render it — which compat filters to register and whether to expose the flat data cascade.
 * Both callers use this one function so preview ≡ build.
 *
 * This package is the convergence point that knows *both* engines (it already depends on
 * `@timber/jekyll-compat`), so the dispatch lives here rather than being duplicated in the CLI
 * build and the app preview.
 */

export interface ThemeManifest {
  engine?: string;
  data?: Record<string, unknown>;
}

export interface ThemeRuntime {
  /** The engine-extension hook to pass to `renderPage`/`createEngine`. */
  extend: (engine: Liquid) => void;
  /** Whether to expose the page's front matter at the top level (Eleventy's flat cascade). */
  flattenData: boolean;
  /** Theme-level globals to expose at the top level (Eleventy `_data/*.json`), if any. */
  globals?: Record<string, unknown>;
}

/** Parse a `theme.json` blob (or undefined) into a manifest, tolerating malformed JSON. */
export function parseThemeManifest(json: string | undefined): ThemeManifest | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ThemeManifest;
  } catch {
    return null;
  }
}

/**
 * Resolve a theme's manifest to its render runtime. Eleventy themes register the Eleventy
 * filters and render with the flat data cascade + their `_data` globals; everything else
 * (native Timber + imported Jekyll) registers the Jekyll ecosystem filters and reads `page.*` —
 * byte-identical to before the engine seam existed.
 */
export function themeRuntime(manifest: ThemeManifest | null): ThemeRuntime {
  if (manifest?.engine === 'eleventy') {
    return {
      extend: registerEleventyCompat,
      flattenData: true,
      globals: manifest.data ?? {},
    };
  }
  return { extend: registerJekyllCompat, flattenData: false };
}
