# Multiple languages (i18n)

Timber can run a site in more than one language. It's **opt-in**: a fresh site is
single-language and behaves exactly as if this feature didn't exist. You turn it on by
declaring your languages in site settings.

The model is one that static-site generators use (Hugo/Jekyll/Astro), adapted to Timber's
bundles: **each language version of a page is its own bundle** (its own `index.md`), and the
variants are linked by a shared key. That keeps every existing guarantee — byte-stable
Markdown, per-page draft/public, per-page validation — working unchanged for each language.

---

## Before you enable it

Two things have to be true, and one has a consequence worth understanding.

1. **Your site must run a Timber version that includes i18n.** The editor and the build come
   from the `TIMBER_REF` pinned in your `.github/workflows/deploy.yml` (the template ships
   `main`). If yours tracks `main`, just re-run the deploy workflow. If you pinned a tag/SHA,
   bump it to one that includes multilingual support.

2. **Enabling i18n prefixes every page URL with its language.** `/<type>/<slug>/` becomes
   `/<lang>/<type>/<slug>/` for *every* language, including the default — `/posts/hello/` →
   `/en/posts/hello/`. The homepage stays at `/`. Timber does **not** emit automatic redirects
   for this shift, so on an already-public site with inbound links or search rankings, treat
   turning i18n on as a deliberate migration.

---

## Enable it

Add `languages` (a list of [BCP-47](https://en.wikipedia.org/wiki/IETF_language_tag) codes)
and `defaultLanguage` to **`content/settings/index.md`**:

```yaml
---
title: My Timber Site
description: A site built with Timber.
baseUrl: https://example.com
homepage: PAGE-HOME
languages:
  - en
  - fr
defaultLanguage: en
---
```

- `languages` — the languages your site offers, in the order you want them shown. **An empty
  or absent list means single-language** (i18n off).
- `defaultLanguage` — the primary language. Optional; defaults to the first entry in
  `languages`. Existing content that has no explicit language is treated as this language.

These fields are in the default settings schema, so you can edit them in the editor's settings
form. (Even without the schema fields, Timber reads them — front matter is tolerant.)

---

## How content is stored

Each language variant is a normal bundle, with the language as a path segment:

```
content/
  posts/
    en/
      hello/
        index.md        # lang: en
    fr/
      bonjour/
        index.md        # lang: fr
```

- Existing content at `content/<type>/<slug>/` (no language segment) keeps working and is
  treated as the **default language**. You don't have to move it.
- New pages you create get the `content/<type>/<lang>/<slug>/` layout automatically.
- Slugs are per-language, so the English and French variants can have different slugs
  (`hello` vs `bonjour`).
- Each variant carries `lang` and a shared `translationKey` in its front matter. The
  `translationKey` is what links the variants as translations of one another — you never edit
  it by hand; the editor manages it.

---

## Working in the editor

Once i18n is on (and the new Timber is deployed):

- **Language chips.** Each page in the sidebar shows its language. Pages that have several
  translations collapse into **one row** with a chip per language — click a chip to jump to
  that variant. A missing language shows as a muted gap, so translation coverage reads at a
  glance.
- **"Needs translation" filter.** A checkbox by the search box narrows the list to pages that
  are missing one or more languages — your coverage to-do list.
- **Add translation.** On a page, open the **⋯** menu → **Add translation**, pick a language
  that doesn't exist yet, and Timber creates a **draft** copy in that language: same content
  to translate in place, images carried over, linked to the original. Translate it, then mark
  it Public when it's ready — each language publishes independently, so you can ship English
  while French is still a draft.

---

## Theming

The shipped default theme is already multilingual-aware — you get a `<html lang>`, `hreflang`
alternate tags, and a language switcher (shown once a page has 2+ translations) for free.

If you're writing your own templates, these are available:

| Variable | What it is |
|---|---|
| `page.lang` | the current page's language code |
| `page.translations` | list of `{ lang, url, title }` for every variant (including this one) — build a switcher |
| `seo.alternates` | list of `{ lang, href }` for `hreflang` link tags (absolute URLs; includes `x-default`) |
| `site.languages`, `site.defaultLanguage` | the declared languages, from settings |

Collection entries also carry a `lang`, so a listing can show just the current language:

```liquid
{% assign mine = collections.posts | where: 'lang', page.lang %}
{% for post in mine %}
  <a href="{{ site.basePath }}{{ post.url }}">{{ post.title }}</a>
{% endfor %}
```

A minimal switcher:

```liquid
{% if page.translations.size > 1 %}
<nav aria-label="Language">
  {% for t in page.translations %}
    <a href="{{ site.basePath }}{{ t.url }}"{% if t.lang == page.lang %} aria-current="true"{% endif %}>{{ t.lang }}</a>
  {% endfor %}
</nav>
{% endif %}
```

And `hreflang` alternates in `<head>`:

```liquid
{% for alt in seo.alternates %}
<link rel="alternate" hreflang="{{ alt.lang }}" href="{{ alt.href }}" />
{% endfor %}
```

---

## Not covered yet

These are deliberately deferred; plan around them for now:

- **Per-language navigation.** `config/navigation.yml` is shared across languages. A
  language-specific menu (each language pointing at its own pages) isn't wired yet.
- **Cross-language references.** A reference field points at one specific object (one
  language's variant), not "the same-language sibling."
- **UI-string / settings localization.** The site title, tagline, and theme strings ("Read
  more") aren't per-language.
- **Multilingual homepage.** The `homepage` setting names one object, rendered at `/`.
  Per-language home pages (`/en/`, `/fr/`) aren't routed yet.
