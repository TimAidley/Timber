# Spike: rendering a real Jekyll theme (Minima) through Timber

**Status: throwaway proof-of-concept.** This directory is a feasibility spike for the
"borrow Jekyll themes" investigation — it is **not** shipped and is not part of any
package's build or test run. It exists to convert the paper audit into a working demo.

## What it proves

The **unmodified** Minima `_layouts` + `_includes` (vendored verbatim under `minima-src/`,
MIT — see `minima-src/LICENSE.txt`) render real content pages through **Timber's own
generator and content APIs** (`renderPage`, `siteContext`, `assembleCollections`,
`pageSeo`, `urlFor`, `withCollectionAliases`), given three ingredients:

1. **Native Tier-1 changes** (these are real, in `@timber/generator` + `@timber/content`,
   unit-tested — see `packages/generator/test/urlFilters.test.ts`):
   - `relative_url` / `absolute_url` filters (prefix `site.basePath` / `site.baseUrl`).
   - computed `page.url` / `page.collection` / `page.content` in the render context.
   - `withCollectionAliases()` — `site.<type>` (+ `site.time`) over the same data as
     `collections.<type>`, without clobbering settings keys.
2. **A thin compat shim** (`jekyllCompat.mjs`, spike-local): the Jekyll *ecosystem* filters
   Timber doesn't ship (`date_to_xmlschema`, `slugify`, `jsonify`, `xml_escape`,
   `number_of_words`, a Ruby-strftime `date`) and the `{% seo %}` / `{% feed_meta %}` tags
   (`{% seo %}` emits `<head>` metadata from Timber's computed `seo` bag).
3. **A mechanical import transform** (`importJekyllTemplate.mjs`): rewrites the handful of
   structural idioms — front-matter `layout:` chaining → `{% layout %}/{% block %}`,
   `{% include x.html a=b %}` → `{% include 'x', a: b %}`, `include.foo` → `foo`, and drops
   now-redundant `| escape` (see finding 4).

Run it:

```bash
node spike/jekyll-minima/render.mjs   # writes _site/, prints 12/12 assertions
```

## Findings

- **✅ Go.** Minima renders end-to-end. Every assertion passes; output is clean HTML with no
  unresolved Liquid.
- **LiquidJS `{% include %}` already shares parent scope**, exactly like Jekyll's — so the
  audit's biggest worry (isolated `{% render %}` breaking shared-scope includes) does *not*
  bite. Only the param **namespace** differs (`include.foo` vs bare `foo`), a one-line
  rewrite. This is the single most important de-risking result for the *complex* themes.
- **`{% seo %}` maps cleanly onto Timber's `seo` bag** — the compat tag is ~10 lines.
- **`site.pages` nav works via one computed field** (`entry.path = entry.url`) — the audit's
  "re-express nav" turned out to be a thin alias, not a rewrite, for Minima.
- **Sass is a non-blocker for a static first cut**: dart-sass (pure JS, no native dep, fits
  SPEC §2) compiled Minima's SCSS — including the Liquid-interpolated skin `@import` — after
  resolving the skin to `classic`. It ran as an offline step; a real integration would add a
  Sass build stage (or ship pre-compiled CSS).
- **NEW compat rule surfaced — escaping.** Jekyll's Liquid does *not* auto-escape; themes
  call `| escape` explicitly. Timber auto-escapes by default (SPEC §6), so a ported theme
  double-escapes (`&` → `&amp;amp;`). A compat layer must reconcile this: either disable
  Timber's auto-escape in compat mode (Jekyll-faithful) or strip the redundant explicit
  escapes on import. The spike strips them; the design decision is worth making explicitly.

## Real vs throwaway

| Part | Where | Keep? |
|---|---|---|
| `relative_url`/`absolute_url`, `page.url/collection/content`, `withCollectionAliases` | `packages/generator`, `packages/content` (+ tests) | **Real** — additive, useful regardless of the Jekyll decision. Would need SPEC §6 template-contract notes if kept. |
| compat shim, import transform, runner, vendored Minima | `spike/jekyll-minima/` | Throwaway — illustrative only. |

The Tier-1 changes stand on their own merits; nothing here reverses SPEC §2 yet. Adopting
"support Tier-A Jekyll themes" as a goal remains a separate, spec-gated decision.
