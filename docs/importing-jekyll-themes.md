# Importing a Jekyll theme

Timber owns its generator, but because it templates with **LiquidJS** (the Jekyll /
GitHub-Pages lineage), a large slice of the **Jekyll** theme ecosystem can be *imported* and
rendered by Timber's own generator — you get a proven design and its documentation without
running Jekyll. This is the **Tier-A** compatibility path (SPEC §2). A theme is transformed
**once** on import; it is never executed by Jekyll.

See also: SPEC §2 (the tiered decision), SPEC §6 (the template contract), ARCHITECTURE.md
(where each piece lives).

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
- **`registerJekyllCompat(engine)`** — the Jekyll *ecosystem* Liquid filters and tags Timber
  doesn't ship natively: `date_to_xmlschema`, `date_to_string`, `slugify`, `jsonify`,
  `number_of_words`, a Ruby-`strftime` `date`, and `{% seo %}` / `{% feed_meta %}` (the former
  emits `<head>` metadata from Timber's computed `seo` bag; the latter is a no-op, RSS being
  deferred). The high-frequency `relative_url` / `absolute_url` are **native** to the
  generator, not here.

## Rendering an imported theme

```ts
import { renderPage } from '@timber/generator';
import { importJekyllTheme, registerJekyllCompat } from '@timber/jekyll-compat';

const templates = importJekyllTheme(
  { ...layouts, ...includes }, // bare name → source, e.g. { base: '…', post: '…', head: '…' }
  'base',                      // the theme's root layout
);

const html = await renderPage({
  markdown,          // the page's index.md
  template: templates[entryTemplate], // e.g. templates.post
  templates,
  site, collections, seo, url, // from Timber's content APIs (siteContext / assembleCollections / …)
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

- **CSS/Sass** is a separate step. Timber copies CSS verbatim and has no Sass compiler yet;
  compile a theme's SCSS to CSS on import (dart-sass — pure JS) or ship pre-compiled CSS.
- **`layout.*` front-matter bag** — a theme that stashes asset lists in a layout's own front
  matter and reads them via `layout.common-css` etc. is not yet supported (those `<link>`s
  render empty). Tier-B-ish; deferred.
- **Parenthesized conditions** — LiquidJS rejects `{% if a and (b != c) %}` (SPEC §6: no parens
  in conditions). Rare; a one-line manual edit per occurrence.
- **Pagination, taxonomy/archive pages, `site.data` i18n, RSS/feeds** — Tier-B features Timber
  defers; a theme relying on them imports only in **degraded** form. Themes that are really a
  JS/Sass/PWA app with custom plugins (Tier C, e.g. Chirpy) are out of scope — rebuild the look
  using their assets as inputs instead.
