import { parseFrontMatter } from '@timber/generator';
import { importJekyllTheme } from './importTheme.js';

/**
 * The pure, isomorphic core of "adopt a Jekyll theme" — it turns a theme's files (as an
 * in-memory map, from either the filesystem in the CLI or an uploaded zip in the browser) into
 * the exact write-set a Timber repo needs: `templates/*.liquid` + the theme's assets, with the
 * SCSS source carried over (compiled later by @timber/sass, isomorphically). No fs, no commit —
 * the caller writes the plan to disk (CLI) or commits it via the host provider (browser).
 */

/** A theme's files, keyed by **theme-root-relative** posix path, split by text vs binary. */
export interface ThemeFiles {
  /** Text files: `_layouts/*.html`, `_includes/*.html`, `assets/**\/*.{scss,css,js,…}`, `_sass/**`. */
  text: Record<string, string>;
  /** Binary files (images, fonts) under `assets/`. */
  binary?: Record<string, Uint8Array>;
}

/** What an engine's collector returns: the transformed templates + which layouts are root/default. */
export interface TemplateCollection {
  /** Bare name (source path relative to the template dir, minus extension) → Timber Liquid. */
  templates: Record<string, string>;
  rootLayout: string;
  defaultLayout: string;
}

export interface CollectOptions {
  rootLayout?: string;
  defaultLayout?: string;
}

/**
 * A source-system adapter (SPEC §2 → Tier A). The shared {@link planThemeImport} owns the
 * folder-prefixing, type wiring, asset routing, and manifest; an engine only supplies how to
 * turn *its* theme files into Timber templates (and optionally its runtime name + globals).
 * `@timber/jekyll-compat` ships {@link jekyllEngine}; `@timber/eleventy-compat` ships its own.
 */
export interface ThemeEngine {
  /**
   * Runtime engine id written to the theme manifest (`themes/<name>/theme.json`), so the build
   * and preview apply the right render mode. Omitted for the native/Jekyll engine, which reads
   * `page.*` and needs no marker (import stays byte-identical).
   */
  name?: string;
  /** Transform the theme's files into Timber templates + root/default layout names. */
  collect(theme: ThemeFiles, opts: CollectOptions): TemplateCollection;
  /** Theme-level globals to expose at render (e.g. Eleventy `_data/*.json`) → `manifest.data`. */
  globals?(theme: ThemeFiles): Record<string, unknown>;
}

export interface PlanThemeOptions extends CollectOptions {
  /** The source-system engine (defaults to {@link jekyllEngine}). */
  engine?: ThemeEngine;
  /** Per-content-type layout wiring `{ <type>: <layout> }` → `templates/<type>.liquid`. */
  typeMap?: Record<string, string>;
  /**
   * Import into a self-contained theme folder: every path is written under
   * `themes/<themeName>/` (SPEC §13), so the theme sits beside any others and the settings
   * singleton's `activeTheme` selects it. Omit to write to the legacy root (`templates/` +
   * `assets/`), the pre-themes layout.
   */
  themeName?: string;
}

/** The write-set to apply to a Timber repo, keyed by **repo** path. */
export interface ThemeImportPlan {
  /** `templates/<name>.liquid` → Liquid source. */
  templates: Record<string, string>;
  /** Text files to write (assets, incl. SCSS source; `_sass/` mapped under `assets/_sass/`). */
  textFiles: Record<string, string>;
  /** Binary files to write (images, fonts), by repo path. */
  binaryFiles: Record<string, Uint8Array>;
  rootLayout: string;
  defaultLayout: string;
  /** The `type → layout` wiring applied (from `typeMap`). */
  mapped: Record<string, string>;
  /** The theme folder written to (`themes/<name>/`), or `null` for the legacy root. */
  themeName: string | null;
  /** The source engine's runtime id (e.g. `eleventy`), or `null` for native/Jekyll. */
  engine: string | null;
}

/** Extract `_layouts`/`_includes` bare-name → source from the theme's text files. */
function collectHtml(text: Record<string, string>, sub: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`^${sub}/([^/]+)\\.html$`);
  for (const [path, source] of Object.entries(text)) {
    const m = re.exec(path);
    if (m) out[m[1]!] = source;
  }
  return out;
}

/** True if a template's front matter declares a `layout:` (i.e. it chains to a parent). */
function chainsToParent(source: string): boolean {
  const layout = parseFrontMatter(source).data.layout;
  return typeof layout === 'string' && layout.length > 0;
}

/**
 * The **Jekyll** engine: `_layouts/` + `_includes/` (bare-name HTML) → Timber templates via
 * {@link importJekyllTheme}. Reads `page.*` like native Timber, so it needs no manifest marker
 * (`name` omitted) — a Jekyll import stays byte-identical to before the engine seam.
 */
export const jekyllEngine: ThemeEngine = {
  collect(theme, opts) {
    const layouts = collectHtml(theme.text, '_layouts');
    const includes = collectHtml(theme.text, '_includes');
    if (Object.keys(layouts).length === 0) {
      throw new Error('no _layouts/ found — is this a Jekyll theme?');
    }
    const roots = Object.keys(layouts).filter((n) => !chainsToParent(layouts[n]!));
    const rootLayout =
      opts.rootLayout ??
      (roots.includes('base') ? 'base' : roots.includes('default') ? 'default' : roots[0]);
    if (!rootLayout)
      throw new Error('could not determine a root layout (all layouts chain to a parent?)');

    const { templates } = importJekyllTheme({ ...layouts, ...includes }, rootLayout);

    const layoutNames = Object.keys(layouts);
    const defaultLayout =
      opts.defaultLayout ??
      (layoutNames.includes('default')
        ? 'default'
        : layoutNames.includes('page')
          ? 'page'
          : rootLayout);
    return { templates, rootLayout, defaultLayout };
  },
};

/** Plan a theme import (see {@link ThemeImportPlan}); pure — no fs, no network. */
export function planThemeImport(
  theme: ThemeFiles,
  options: PlanThemeOptions = {},
): ThemeImportPlan {
  const engine = options.engine ?? jekyllEngine;
  const { templates: imported, rootLayout, defaultLayout } = engine.collect(theme, options);

  // Write into a self-contained `themes/<name>/` folder when a name is given (SPEC §13), so
  // the theme sits beside any others; otherwise the legacy root. Every repo path — templates
  // and assets alike — carries this prefix.
  const themeName = options.themeName ?? null;
  const prefix = themeName ? `themes/${themeName}/` : '';

  const templates: Record<string, string> = {};
  for (const [name, source] of Object.entries(imported))
    templates[`${prefix}templates/${name}.liquid`] = source;
  if (!imported['default'])
    templates[`${prefix}templates/default.liquid`] = imported[defaultLayout]!;

  const mapped: Record<string, string> = {};
  for (const [type, layout] of Object.entries(options.typeMap ?? {})) {
    const source = imported[layout];
    if (source === undefined) {
      throw new Error(
        `map ${type}=${layout}: no layout "${layout}" (have: ${Object.keys(imported).join(', ')})`,
      );
    }
    templates[`${prefix}templates/${type}.liquid`] = source;
    mapped[type] = layout;
  }

  // Assets: `assets/**` keep their path; `_sass/**` move under `assets/_sass/` (Timber's Sass
  // load path). Both go under the theme prefix. Text vs binary is preserved from the input.
  const repoPathFor = (themePath: string): string | undefined => {
    if (themePath.startsWith('assets/')) return `${prefix}${themePath}`;
    if (themePath.startsWith('_sass/'))
      return `${prefix}assets/_sass/${themePath.slice('_sass/'.length)}`;
    return undefined; // template dirs handled above; config etc. ignored
  };

  const textFiles: Record<string, string> = {};
  for (const [themePath, source] of Object.entries(theme.text)) {
    const repoPath = repoPathFor(themePath);
    if (repoPath) textFiles[repoPath] = source;
  }
  const binaryFiles: Record<string, Uint8Array> = {};
  for (const [themePath, bytes] of Object.entries(theme.binary ?? {})) {
    const repoPath = repoPathFor(themePath);
    if (repoPath) binaryFiles[repoPath] = bytes;
  }

  // Theme manifest (SPEC §2): a non-native engine records its runtime id (+ any `_data`
  // globals) at `themes/<name>/theme.json`, so the build and preview apply the right render
  // mode. Native/Jekyll (no `engine.name`) writes none — nothing to switch on.
  const engineName = engine.name ?? null;
  if (engineName && prefix) {
    const data = engine.globals?.(theme) ?? {};
    const manifest: Record<string, unknown> = { engine: engineName };
    if (Object.keys(data).length > 0) manifest.data = data;
    textFiles[`${prefix}theme.json`] = `${JSON.stringify(manifest, null, 2)}\n`;
  }

  return {
    templates,
    textFiles,
    binaryFiles,
    rootLayout,
    defaultLayout,
    mapped,
    themeName,
    engine: engineName,
  };
}
