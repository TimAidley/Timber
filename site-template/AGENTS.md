# Notes for AI assistants working in this repo

This is a [Timber](https://github.com/TimAidley/Timber) site: a git-backed static site
whose content is normally edited in a browser CMS at `/<repo>/edit/`. `main` holds source
only — never built HTML. A GitHub Action builds and deploys it.

**Read [`AUTHORING.md`](AUTHORING.md) before writing or editing anything under
`content/`.** The rest of this file is the short version.

## The thing that will catch you out

Content files are normally written by the editor, which serialises them in one exact form:

```
---
<yaml front matter>
---

<markdown body>
```

— including the **blank line after the closing `---`, even when there is no body**.

If you hand-write an `index.md` whose bytes differ from that (different YAML quoting, a
hand-wrapped long value, a missing blank line), the file is still valid and the site builds
fine, but **the editor will show the object as modified the moment it loads it**, and
reverting won't clear it. This is the single most common way to break a Timber site's
editing experience without breaking the site.

So: **after any change under `content/`, run `timber fmt .`** — or generate the file with
`serializeDocument` from `@timber/generator` in the first place, which is correct by
construction.

## Checks to run before you commit

```sh
timber validate .     # schemas, required fields, references, duplicate ids
timber fmt --check .  # every object matches what the editor writes
```

Both must pass. CI runs them on pull requests and on pushes to branches other than `main`
and `*_wip`.

## Conventions worth knowing

- **One folder per object**, containing `index.md` and its own images. The folder name is
  the slug and drives the URL.
- **Draft by default.** An object without `public: true` will not appear on the site. Don't
  add `public: true` to something the user didn't ask to publish.
- **`id` is identity.** Reference fields and `config/navigation.yml` point at ids, so
  changing one breaks links. Renaming a folder is fine (it changes the URL); changing an
  `id` is not.
- **Fields are schema-defined.** Check `config/schemas/<type>.yml` before inventing a
  front-matter key. Undeclared keys pass through rather than erroring, so a typo fails
  silently — it just never renders.
- **`<!--more-->` ends the excerpt.** Listing pages show the first paragraph of a post
  unless the body carries that marker, in which case they show everything before it. It
  renders as nothing. Add one when a post's opening should be more than one paragraph.
- **Don't commit built HTML.** There is no `_site/` in git; the Action builds it.
- **Don't edit `themes/<name>/` to change content**, or `content/` to change layout. The
  theme is Liquid templates + CSS; the content is data.

## Branches

- `main` — the live site.
- `<login>_wip` — the browser editor's working branch. **Leave it alone**; the editor owns
  it and rewrites it. Pushing to someone's WIP branch will conflict with their session.
