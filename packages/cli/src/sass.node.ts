import { compileString, type StringOptions } from 'sass';

/**
 * Compile a Jekyll theme's SCSS to CSS — a **Node/CI-side build step**, never the browser
 * bundle. This follows the image precedent (SPEC §7): heavy asset processing (`sharp` for
 * responsive variants, dart-sass here) runs at build time only; the browser preview falls
 * back to committed CSS. dart-sass is pure JS, but kept out of the isomorphic packages to
 * keep the browser path lean (SPEC §2).
 *
 * A Jekyll main stylesheet carries **Liquid front matter** (the `---` fence is what marks it
 * for processing) and often a **Liquid interpolation inside `@import`** — e.g. Minima's
 * `@import "minima/skins/{{ site.minima.skin | default: 'classic' }}"`. So compilation is two
 * steps: strip the front matter, resolve any Liquid (the caller supplies `resolve`, using the
 * generator engine + site context so preview ≡ build for the *skin choice*), then compile
 * with dart-sass resolving `@import`s against `loadPaths` (the theme's `_sass` dir).
 */
export interface CompileStylesheetOptions {
  /** Raw SCSS source (may start with a Jekyll `---` front-matter fence + contain Liquid). */
  source: string;
  /** Directories dart-sass resolves `@import` / `@use` against (e.g. the theme's `_sass`). */
  loadPaths?: string[];
  /**
   * Resolve Liquid in the (front-matter-stripped) SCSS — e.g. the skin `@import`
   * interpolation. Jekyll runs SCSS front-matter files through Liquid, so this mirrors that.
   * Omit for SCSS with no Liquid. Returns the resolved SCSS (sync or async).
   */
  resolve?: (scss: string) => string | Promise<string>;
  /** Output style; defaults to `compressed` (production CSS). */
  style?: StringOptions<'sync'>['style'];
}

/** Strip a leading Jekyll `---\n…\n---` front-matter fence (SCSS main files carry one). */
function stripFrontMatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/** Compile theme SCSS → CSS (see {@link CompileStylesheetOptions}). */
export async function compileThemeStylesheet(
  options: CompileStylesheetOptions,
): Promise<string> {
  let scss = stripFrontMatter(options.source);
  if (options.resolve) scss = await options.resolve(scss);
  const result = compileString(scss, {
    loadPaths: options.loadPaths ?? [],
    style: options.style ?? 'compressed',
    // Jekyll themes universally use `@import` (which dart-sass now deprecates in favour of
    // `@use`). That's the theme's code, not something a site owner can fix, so silence the
    // expected noise rather than flood the build log.
    silenceDeprecations: ['import'],
  });
  return result.css;
}
