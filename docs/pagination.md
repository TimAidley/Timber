# Paginated listings

When a collection outgrows a single page — a blog with fifty posts, an events archive — you
split it across several pages. In Timber a **paginated listing is an ordinary page** that
says which collection it lists. The build turns that one page into as many as it needs.

Nothing to install and no schema change: you add three lines of front matter to a page.

---

## Add a listing

Create (or pick) a page and give it a `paginate` block:

```yaml
---
id: 0c9f4b2e-…
title: Blog
public: true
paginate:
  collection: posts
  size: 10
---

Everything I've written lately.
```

- **`collection`** — the name of a collection type (the file name of its
  `config/schemas/<name>.yml`, so `posts` for `config/schemas/posts.yml`). Required.
- **`size`** — how many entries per page. Optional; defaults to **10**.

That's it. The page keeps everything an ordinary page has — its title, its body (which
renders above the list, on every page), its own description and social image. The listing
is added underneath by the theme.

`paginate` isn't a schema field, so there's no form widget for it yet: add it in the
editor's **Markdown** tab (the same place you'd see `aliases` or `created`). The preview
updates as soon as you've typed it.

---

## The URLs you get

With 25 posts at `size: 10`, a listing page at `/blog/` builds as:

| Page | URL |
|---|---|
| 1 | `/blog/` |
| 2 | `/blog/page/2/` |
| 3 | `/blog/page/3/` |

Page 1 stays at the page's own URL — no redirect, no `/blog/page/1/` duplicate — so an
existing link to `/blog/` keeps working when a listing grows. On a multilingual site the
language prefix comes along as usual: `/fr/blog/page/2/`.

Timber also handles the SEO for you: each page gets its **own canonical URL**, pages 2+ get
a `· Page 2 of 3` title suffix so they aren't duplicate titles, `<link rel="prev">`/`next`
are emitted where a neighbouring page exists, and **every** page is listed in
`sitemap.xml`.

---

## What lands on each page

Entries come from the same `{{ collections }}` your templates already use, so:

- **drafts never appear** — only public objects are listed;
- entries are ordered **most recent first** (by the type's first date field), the same order
  a `{% for %}` loop over the collection gives;
- the listing page **never lists itself**, if it happens to paginate its own type;
- on a multilingual site, a listing in French lists the **French** entries (plus any entry
  with no language of its own).

An **empty collection is fine** — the page still builds, with an empty list and no pager, so
a blog index can go up before the first post.

---

## Theming

The default theme already renders listings, so a `paginate` block works with no theme
changes. If you're writing your own template, a paginated page has a **`paginator`** in
scope; an ordinary page has none, so gate on it:

```liquid
{% if paginator %}
<ul class="listing">
  {% for item in paginator.items %}
  <li><a href="{{ site.basePath }}{{ item.url }}">{{ item.title }}</a></li>
  {% endfor %}
</ul>
{% render 'pagination', paginator: paginator, basePath: site.basePath %}
{% endif %}
```

(`{% render %}` runs in an isolated scope, which is why the pager snippet is passed what it
needs explicitly.)

### `paginator`

| Key | What it is |
|---|---|
| `items` | this page's entries — each one exactly what `collections.<type>` gives (fields + `url`, `slug`, `id`) |
| `page` | this page's number, starting at 1 |
| `totalPages` | how many pages the listing has |
| `totalItems` | how many entries in the whole listing |
| `size` | entries per page |
| `url` | this page's URL |
| `firstUrl` / `lastUrl` | the first and last page's URLs |
| `previousUrl` / `nextUrl` | neighbouring pages — **absent** at the ends, so `{% if %}` works |
| `previousPage` / `nextPage` | their numbers, likewise absent at the ends |
| `pages` | every page as `{ number, url, current }`, for a numbered pager |

All URLs are site-relative, so prefix them with `{{ site.basePath }}` (or use the
`relative_url` filter) exactly as you would any other in-page link.

**Imported Jekyll themes:** the same object also answers to Jekyll's pagination names —
`paginator.posts`, `per_page`, `total_pages`, `total_posts`, `previous_page`,
`previous_page_path`, `next_page`, `next_page_path` — so a theme's existing pager markup
works unchanged. The difference is where pagination is *declared*: Timber puts `paginate` on
the listing page, not `paginate:` in a site-wide config.

---

## If something's wrong

A bad `paginate` block is a validation error, so it shows up in the editor and **blocks
publishing** (it can still be saved as a draft — Timber never blocks saving your work). The
cases it catches:

- `collection` naming a type that doesn't exist, or a **singleton** type — only collections
  can be paginated;
- `size` that isn't a whole number of 1 or more;
- a `paginate` block on a type that renders no pages (like `settings`, which is `page: false`);
- a `paginate` value that isn't a mapping at all — e.g. `paginate: posts`.

---

## Not covered yet

- **Archive and taxonomy pages** — "posts from 2025", "everything tagged _travel_" — which
  generate *many* listings from one declaration rather than one listing over many pages.
- **Sorting or filtering in the `paginate` block.** A listing paginates the collection in its
  standard most-recent-first order. For a different subset today, loop
  `collections.<type>` with the query filters (`where`, `where_gte`, `where_exp`) in a
  non-paginated template.
- **A form widget for `paginate`**, and flipping through pages 2..N in the editor preview
  (the preview shows page 1).
