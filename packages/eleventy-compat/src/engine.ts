import type { ThemeEngine, ThemeFiles } from '@timber/jekyll-compat';
import { importEleventyTheme } from './importTheme.js';

/**
 * The **Eleventy** engine (SPEC §2 → Tier A). Collects a theme's `_includes/**` (layouts +
 * partials, keyed by path relative to `_includes/`, minus extension), transforms each to Timber
 * Liquid, and detects the root/default layout by following the front-matter `layout:` chain.
 * Declares `name: 'eleventy'` so {@link planThemeImport} writes a `theme.json` manifest and the
 * build/preview render it with the flat data cascade (`flattenData` + the `_data/*.json` globals).
 */

const stripExt = (s: string): string => s.replace(/\.(liquid|html|njk)$/i, '');

/** The (extension-stripped) `layout:` a template chains to, or undefined. */
function layoutRefOf(source: string): string | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return undefined;
  const lm = /^layout:\s*(.+?)\s*$/m.exec(m[1]!);
  return lm ? stripExt(lm[1]!.trim().replace(/['"]/g, '')) : undefined;
}

/** Read `_includes/**.{liquid,html}` → bare-path-keyed sources (`layouts/default`, `navbar`, …). */
function collectIncludes(text: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, source] of Object.entries(text)) {
    const m = /^_includes\/(.+\.(?:liquid|html))$/.exec(path);
    if (m) out[stripExt(m[1]!)] = source;
  }
  return out;
}

/** Prefer a conventional name from `candidates`, else the first entry. */
function prefer(names: string[], candidates: string[]): string | undefined {
  for (const c of candidates) if (names.includes(c)) return c;
  return names[0];
}

export const eleventyEngine: ThemeEngine = {
  name: 'eleventy',

  collect(theme: ThemeFiles, opts) {
    const raw = collectIncludes(theme.text);
    if (Object.keys(raw).length === 0) {
      throw new Error('no _includes/ templates found — is this a Liquid Eleventy theme?');
    }

    const layoutOf: Record<string, string | undefined> = {};
    for (const [name, src] of Object.entries(raw)) layoutOf[name] = layoutRefOf(src);

    // Root layout: a chain target that itself declares no `layout:`. Fall back to a
    // conventionally-named base layout if nothing chains (a single-layout theme).
    const targets = [...new Set(Object.values(layoutOf).filter((l): l is string => !!l))];
    const roots = targets.filter((t) => raw[t] !== undefined && !layoutOf[t]);
    const rootLayout =
      opts.rootLayout ??
      prefer(roots, ['layouts/base', 'layouts/default', 'base', 'default']) ??
      prefer(Object.keys(raw), ['layouts/base', 'layouts/default', 'base', 'default'])!;

    // Default layout (Timber's per-type fallback → templates/default.liquid): the theme's
    // generic single-content layout. Prefer a post/page/single child layout, else root.
    const children = Object.keys(raw).filter((k) => layoutOf[k]);
    const defaultLayout =
      opts.defaultLayout ??
      prefer(children, [
        'layouts/post',
        'layouts/page',
        'layouts/single',
        'post',
        'page',
        'single',
      ]) ??
      rootLayout;

    return { templates: importEleventyTheme(raw, rootLayout), rootLayout, defaultLayout };
  },

  globals(theme: ThemeFiles): Record<string, unknown> {
    // `_data/*.json` → top-level globals keyed by filename (Eleventy's data cascade). `.js`
    // data files run arbitrary JavaScript and can't be parsed statically — they're skipped
    // (the theme falls back to Timber's settings for `site`, or the user fills them in).
    const out: Record<string, unknown> = {};
    for (const [path, source] of Object.entries(theme.text)) {
      const m = /^_data\/([^/]+)\.json$/.exec(path);
      if (!m) continue;
      try {
        out[m[1]!] = JSON.parse(source);
      } catch {
        // malformed JSON → skip it rather than fail the whole import
      }
    }
    return out;
  },
};
