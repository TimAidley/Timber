# Importing a Jekyll theme

Timber owns its generator, but because it templates with **LiquidJS** (the Jekyll /
GitHub-Pages lineage), a large slice of the **Jekyll** theme ecosystem can be *imported* and
rendered by Timber's own generator — you get a proven design and its documentation without
running Jekyll. This is the **Tier-A** compatibility path (SPEC §2). A theme is transformed
**once** on import; it is never executed by Jekyll.

See also: SPEC §2 (the tiered decision), SPEC §6 (the template contract), ARCHITECTURE.md
(where each piece lives).

## Quick start

The **adopt-once** import runs two ways — both do the same transform (they share the
isomorphic `planThemeImport` core), so pick whichever fits.

Each imported theme lands in its **own `themes/<name>/` folder**, and the site's
`settings.activeTheme` is pointed at it — so importing makes the theme live while leaving any
previous theme on disk under its own folder. Switch back, or delete a theme, from
**Advanced → Manage themes** (see [Switching & deleting](#switching--deleting-themes)).

### From the browser (no terminal)

In the editor, open **Advanced → ↓ Import theme**, upload a theme `.zip` (e.g. a repo's
"Download ZIP"), give the theme a **name** (defaulted from the archive), and click **Import**.
It transforms the theme into `themes/<name>/templates/*.liquid` + `themes/<name>/assets/**`,
flips `settings.activeTheme` to it, and commits everything to your working branch in one commit;
reload to pick it up. The build (and the in-editor preview) compile the theme's SCSS
isomorphically — nothing to run locally.

### From the CLI

```sh
timber import-theme path/to/jekyll-theme  path/to/my-site  --name minima
```

It transforms the theme's `_layouts` + `_includes` into native
`themes/<name>/templates/*.liquid`, carries its assets (incl. SCSS source) into
`themes/<name>/assets/`, sets `settings.activeTheme`, and prints a summary — e.g. *"14
templates (root: base, default: page), activated: set activeTheme: minima."* `--name` defaults
to the theme directory's name. After that your repo is an **ordinary Timber site**: `timber
build` compiles the theme's SCSS and renders it, with no further Jekyll step.

- **Per-type layouts.** Every content type falls back to `themes/<name>/templates/default.liquid`
  (the theme's generic single-content layout). To render a type through a specific layout, pass
  `--map <type>=<layout>` (repeatable, or comma-separated) — e.g.
  `timber import-theme theme site --map posts=post --map events=event` writes
  `themes/<name>/templates/posts.liquid` from the theme's `post` layout, and so on. You can also
  add a `<type>.liquid` by hand later.
- **The build auto-registers the Jekyll ecosystem filters/tags** (`{% seo %}`,
  `date_to_xmlschema`, …) — they're additive (no built-in overrides), so nothing extra is
  needed and native sites are unaffected.
- **Re-adopting** an upstream update: re-run `import-theme` with the same `--name`; the
  transform is deterministic, so the diff is clean.

## Switching & deleting themes

Because each theme is a self-contained `themes/<name>/` folder, in the editor's **Advanced →
Manage themes** you can **switch** the active theme (writes `settings.activeTheme`) or **delete**
a theme folder wholesale. The active theme can't be deleted — switch away first — so a site is
never left without a theme. Everything commits to your working branch, so nothing is live until
you publish. A site with no `themes/` folder (or no `activeTheme`) uses the legacy root
`templates/` + `assets/` unchanged.

The rest of this doc covers the **programmatic** API underneath the command.

## What "importing" means

`@timber/jekyll-compat` gives you two things:

- **`importJekyllTheme(files, rootLayout)`** — a mechanical transform from a Jekyll theme's
  `_layouts` + `_includes` into a Timber `TemplateMap`. It rewrites the idioms where Jekyll's
  Liquid and Timber's LiquidJS differ:
  - front-matter `layout:` chaining → LiquidJS `{% layout %}` / `{% block main %}`;
  - `{% include head.html %}` → `{% include 'head' %}`, `{% include x.html a=b %}` →
    `{% include 'x', a: b %}`, and dynamic `{% include {{ file }} %}` → `{% include file %}`;
  - the Jekyll `include.foo` param namespace → bare `foo` locals;
  - dropping redundant `escape` / `escape_once` / `xml_escape` (Timber auto-escapes — see
    "Escaping" below).

  It returns `{ templates, layoutData }` — `layoutData[<layout>]` holds that layout's
  front-matter data (Jekyll's `layout.*`, e.g. a base layout's CSS/JS asset lists). Pass
  `layout: layoutData[rootLayout]` to `renderPage` so `layout.common-css` etc. resolve.
- **`registerJekyllCompat(engine)`** — the Jekyll *ecosystem* Liquid filters and tags Timber
  doesn't ship natively: `date_to_xmlschema`, `date_to_string`, `slugify`, `jsonify`,
  `number_of_words`, `xml_escape`, and `{% seo %}` / `{% feed_meta %}` (the former emits
  `<head>` metadata from Timber's computed `seo` bag; the latter is a no-op, RSS being
  deferred). All **additive** — nothing overrides a LiquidJS built-in (the `date` filter's
  built-in already handles Jekyll's strftime, incl. `%-d`), which is why the CLI build can
  register it for every site safely. The high-frequency `relative_url` / `absolute_url` are
  **native** to the generator, not here.

## Rendering an imported theme

```ts
import { renderPage } from '@timber/generator';
import { importJekyllTheme, registerJekyllCompat } from '@timber/jekyll-compat';

const { templates, layoutData } = importJekyllTheme(
  { ...layouts, ...includes }, // bare name → source, e.g. { base: '…', post: '…', head: '…' }
  'base',                      // the theme's root layout
);

const html = await renderPage({
  markdown,          // the page's index.md
  template: templates[entryTemplate], // e.g. templates.post
  templates,
  site, collections, seo, url, // from Timber's content APIs (siteContext / assembleCollections / …)
  layout: layoutData['base'],  // Jekyll's layout.* — the root layout's front-matter data (asset lists, …)
  extend: registerJekyllCompat,
});
```

Timber's own content pipeline feeds the theme: `site.<type>` aliases (so `site.posts` works),
`page.url`, and the `seo` bag are all part of the native contract (SPEC §6).

## Escaping

Jekyll's Liquid does **not** auto-escape, so Jekyll themes call `| escape` explicitly.
Timber auto-escapes every output by default (an XSS-safe default, SPEC §6). To avoid
double-escaping (`&` → `&amp;amp;`), the import transform **drops** the now-redundant
`escape` / `escape_once` / `xml_escape` filters — Timber still escapes, just once. Auto-escape
stays **on**; it is not disabled for imported themes.

## What works, and the edges

Proven end-to-end against **Minima** (renders + compiles its SCSS) and **Beautiful-Jekyll**
(all 33 templates import to valid Liquid; the core reading path renders).

Known limits (the "mainly compatible, not 100%" residue):

- **CSS/Sass is compiled isomorphically** — the import just commits the theme's SCSS *source*
  (its `assets/**/*.scss` + its `_sass/` partials, placed under `themes/<name>/assets/_sass/`),
  and both the Node build and the browser preview compile it via `@timber/sass` (`compileScss`,
  dart-sass + an in-memory importer) over the **active theme's** load path. A **main** stylesheet
  is a `.scss` with a `---` front-matter fence (compiled to a sibling `.css`, published to
  `/assets`); partials (no fence) are pulled in via `@import`. So **preview ≡ build for styling**
  — no committed-CSS fallback. (SCSS is a general Timber feature now, not import-only: any site
  can author `.scss` in its theme's `assets/`.)
- **In-editor preview** — the editor's live preview registers the same ecosystem filters/tags
  as the build *and* compiles SCSS in-browser (isomorphic dart-sass), so an adopted theme using
  `{% seo %}` and shipping `.scss` previews exactly as it builds (preview ≡ build), edits to a
  theme's `.scss` included.
- **Parenthesized conditions** — LiquidJS rejects `{% if a and (b != c) %}` (SPEC §6: no parens
  in conditions). Rare; a one-line manual edit per occurrence.
- **Pagination, taxonomy/archive pages, `site.data` i18n, RSS/feeds** — Tier-B features Timber
  defers; a theme relying on them imports only in **degraded** form. Themes that are really a
  JS/Sass/PWA app with custom plugins (Tier C, e.g. Chirpy) are out of scope — rebuild the look
  using their assets as inputs instead.
