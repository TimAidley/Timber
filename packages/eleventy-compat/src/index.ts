/**
 * @timber/eleventy-compat — Timber's Eleventy-theme compatibility layer (SPEC §2 → Tier A).
 *
 * Lets **Liquid-authored** Eleventy themes be *imported* and rendered by Timber's own generator,
 * never executed by Eleventy. Two pieces, both pure and isomorphic:
 *
 *   - `registerEleventyCompat(engine)` — the genuinely built-in Eleventy filters Timber doesn't
 *     ship natively (`url`, `slugify`/`slug`, `log`). Pass it as the `extend` hook to `renderPage`.
 *   - `eleventyEngine` — a {@link ThemeEngine} plugged into `@timber/jekyll-compat`'s shared
 *     `planThemeImport`: it collects `_includes/**`, transforms each template (layout chaining,
 *     include/extension idioms, un-spaced tags), and declares the runtime so the build/preview
 *     render with the flat data cascade (front matter + `_data/*.json` at top level).
 *
 * The template *structure* imports mechanically; theme-defined JS filters degrade to
 * pass-through (Timber's engine runs `strictFilters` off), and Nunjucks-authored themes are out
 * of scope (a different language). See `docs/importing-jekyll-themes.md`.
 */
export { importEleventyTemplate, importEleventyTheme } from './importTheme.js';
export type { ImportOptions } from './importTheme.js';
export { registerEleventyCompat } from './register.js';
export { eleventyEngine } from './engine.js';
export { themeRuntime, parseThemeManifest } from './runtime.js';
export type { ThemeManifest, ThemeRuntime } from './runtime.js';
