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

export interface PlanThemeOptions {
  /** The base layout others chain to. Auto-detected (prefers `base`, then `default`) if unset. */
  rootLayout?: string;
  /** Which layout becomes `templates/default.liquid` (the per-type fallback). Auto if unset. */
  defaultLayout?: string;
  /** Per-content-type layout wiring `{ <type>: <layout> }` → `templates/<type>.liquid`. */
  typeMap?: Record<string, string>;
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

/** Plan a theme import (see {@link ThemeImportPlan}); pure — no fs, no network. */
export function planThemeImport(
  theme: ThemeFiles,
  options: PlanThemeOptions = {},
): ThemeImportPlan {
  const layouts = collectHtml(theme.text, '_layouts');
  const includes = collectHtml(theme.text, '_includes');
  if (Object.keys(layouts).length === 0) {
    throw new Error('no _layouts/ found — is this a Jekyll theme?');
  }

  const roots = Object.keys(layouts).filter((n) => !chainsToParent(layouts[n]!));
  const rootLayout =
    options.rootLayout ??
    (roots.includes('base') ? 'base' : roots.includes('default') ? 'default' : roots[0]);
  if (!rootLayout)
    throw new Error('could not determine a root layout (all layouts chain to a parent?)');

  const { templates: imported } = importJekyllTheme(
    { ...layouts, ...includes },
    rootLayout,
  );

  const layoutNames = Object.keys(layouts);
  const defaultLayout =
    options.defaultLayout ??
    (layoutNames.includes('default')
      ? 'default'
      : layoutNames.includes('page')
        ? 'page'
        : rootLayout);

  const templates: Record<string, string> = {};
  for (const [name, source] of Object.entries(imported))
    templates[`templates/${name}.liquid`] = source;
  if (!imported['default'])
    templates['templates/default.liquid'] = imported[defaultLayout]!;

  const mapped: Record<string, string> = {};
  for (const [type, layout] of Object.entries(options.typeMap ?? {})) {
    const source = imported[layout];
    if (source === undefined) {
      throw new Error(
        `map ${type}=${layout}: no layout "${layout}" (have: ${layoutNames.join(', ')})`,
      );
    }
    templates[`templates/${type}.liquid`] = source;
    mapped[type] = layout;
  }

  // Assets: `assets/**` keep their path; `_sass/**` move under `assets/_sass/` (Timber's Sass
  // load path). Text vs binary is preserved from the input.
  const repoPathFor = (themePath: string): string | undefined => {
    if (themePath.startsWith('assets/')) return themePath;
    if (themePath.startsWith('_sass/'))
      return `assets/_sass/${themePath.slice('_sass/'.length)}`;
    return undefined; // _layouts/_includes handled above; config etc. ignored
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

  return { templates, textFiles, binaryFiles, rootLayout, defaultLayout, mapped };
}
