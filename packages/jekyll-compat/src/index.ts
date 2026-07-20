/**
 * @timber/jekyll-compat — Timber's Jekyll-theme compatibility layer.
 *
 * Lets **Tier-A** (Liquid + CSS) Jekyll themes be *imported* and rendered by Timber's
 * generator (SPEC §2 → theme compatibility). Two pieces, both pure and isomorphic:
 *
 *   - `registerJekyllCompat(engine)` — the ecosystem Liquid filters + tags Timber doesn't
 *     ship natively (`date_to_xmlschema`, `slugify`, `{% seo %}`, …). Pass it as the
 *     `extend` hook to `@timber/generator`'s `renderPage`/`createEngine`.
 *   - `importJekyllTheme(files, rootLayout)` — the mechanical transform that rewrites a
 *     Jekyll theme's `_layouts`/`_includes` into a Timber `TemplateMap` (layout chaining,
 *     include syntax, `include.*` namespace, escaping reconciliation).
 *
 * The native pieces this builds on — `relative_url`/`absolute_url`, `page.url`, the
 * `site.<type>` aliases — live in `@timber/generator` and `@timber/content`, not here.
 * Tier-B themes import in a degraded form; Tier-C (app-in-a-theme, e.g. Chirpy) is out of
 * scope. See `docs/importing-themes.md`.
 */
export { registerJekyllCompat } from './register.js';
export { registerJekyllFilters, strftime } from './filters.js';
export { registerJekyllTags } from './tags.js';
export { importJekyllTemplate, importJekyllTheme } from './importTheme.js';
export type { ImportOptions, ImportedTheme } from './importTheme.js';
export { planThemeImport, jekyllEngine } from './planImport.js';
export type {
  ThemeFiles,
  PlanThemeOptions,
  ThemeImportPlan,
  ThemeEngine,
  TemplateCollection,
  CollectOptions,
} from './planImport.js';
export { setFrontMatterScalar } from './activate.js';
