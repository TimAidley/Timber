/**
 * Active-theme resolution (SPEC §13). A themed site keeps each theme in its own
 * `themes/<name>/` folder — `themes/<name>/templates/*.liquid` and the theme's own
 * `themes/<name>/assets/**` — and the settings singleton's `activeTheme` picks the live
 * one. Because themes are independent folders, switching is one setting, deleting is
 * removing a folder, and importing writes a new folder that never touches the others.
 *
 * A pre-themes site (no `activeTheme`, no `themes/` dir) keeps the legacy single root
 * (`templates/` + `assets/`), so this is purely additive — no existing site moves.
 *
 * Pure and isomorphic (no fs/DOM): callers supply a `themeExists` predicate over whatever
 * file listing they hold (a disk walk in the CLI build, a loaded tree in the browser).
 */

/** Repo directory that holds every theme folder. */
export const THEMES_DIR = 'themes';

/** The legacy single-root layout (`templates/` + `assets/`), used by pre-themes sites and as
 *  the default for path helpers that haven't been handed a resolved theme. */
export const LEGACY_THEME: ThemePaths = {
  name: null,
  templatesDir: 'templates',
  assetsDir: 'assets',
  sassLoadPaths: ['assets/_sass'],
};

export interface ThemePaths {
  /** The active theme's name, or `null` for the legacy root layout. */
  name: string | null;
  /** Repo dir holding the theme's templates: `themes/<name>/templates` or `templates`. */
  templatesDir: string;
  /** Repo dir holding the theme's own assets: `themes/<name>/assets` or `assets`. */
  assetsDir: string;
  /**
   * Ordered SCSS load paths for `@import`/`@use` — the theme's own `_sass` first, then the
   * site-level `assets/_sass` (so a themed site can still share site-wide SCSS partials).
   */
  sassLoadPaths: string[];
}

/**
 * Resolve the active theme's template + asset directories from the settings singleton's
 * `activeTheme`. `themeExists(name)` reports whether `themes/<name>/` actually carries a
 * theme, so a dangling `activeTheme` (folder since deleted) falls back to the legacy root
 * rather than yielding a template-less site. With no `activeTheme` set the legacy root
 * (`templates/` + `assets/`) is used unchanged — every pre-themes site.
 */
export function resolveThemePaths(
  activeTheme: string | undefined,
  themeExists: (name: string) => boolean,
): ThemePaths {
  const name = activeTheme && themeExists(activeTheme) ? activeTheme : null;
  if (name === null) return LEGACY_THEME;
  const base = `${THEMES_DIR}/${name}`;
  return {
    name,
    templatesDir: `${base}/templates`,
    assetsDir: `${base}/assets`,
    sassLoadPaths: [`${base}/assets/_sass`, 'assets/_sass'],
  };
}

/**
 * The site output directories an active theme draws assets from, lowest-priority first.
 * In theme mode: the theme's own `assets` (the theme ships them) then the site-level
 * `assets/` (owner uploads — logos, media) which **override** on a path clash, so switching
 * themes never disturbs a site's own uploads. In legacy mode: just `assets/`.
 */
export function assetSourceDirs(theme: ThemePaths): string[] {
  return theme.name === null ? ['assets'] : [theme.assetsDir, 'assets'];
}

/**
 * Map a source asset's repo path to its **site output path** (under `assets/`) by stripping
 * the theme's asset prefix — so `themes/<name>/assets/theme.css` publishes to
 * `assets/theme.css` (the URL the theme's templates reference, exactly as a Jekyll theme-gem
 * merges into `/assets`), while a site-level `assets/logo.png` upload stays put. Returns
 * `null` for a path under neither asset root.
 */
export function assetOutputPath(repoPath: string, theme: ThemePaths): string | null {
  if (theme.name !== null && repoPath.startsWith(`${theme.assetsDir}/`)) {
    return `assets/${repoPath.slice(theme.assetsDir.length + 1)}`;
  }
  if (repoPath.startsWith('assets/')) return repoPath;
  return null;
}
