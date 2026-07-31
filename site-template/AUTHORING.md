# Authoring content by hand

Most of the time you'll edit this site in the browser at `/<repo>/edit/`, and none of this
matters — the editor writes the correct format for you.

This document is for the other times: bulk-importing content, migrating from another site
generator, scripting a change across many files, or asking an AI assistant to write content
for you. In those cases you are writing the files the editor normally owns, and there is
one rule that is easy to miss and annoying to debug.

## The one rule

**Run `timber fmt .` on anything you didn't write in the editor.**

The editor serialises every save as exactly:

```
---
<yaml front matter>
---

<markdown body>
```

Note the **blank line after the closing `---`** — it is there even when the object has no
body at all.

If your file's bytes differ from what the editor would write — different YAML quoting, a
different line-wrap, a missing blank line — the file is still *valid* and the site builds
correctly. But the editor re-serialises it the moment it loads, so the object shows up as
**modified** before you have typed anything. Worse, reverting doesn't fix it: reverting
restores your bytes, the editor re-serialises them again, and the change comes straight
back. It looks like the editor is stuck.

`timber fmt .` rewrites every object into the canonical form. It only touches formatting —
the built site is byte-identical before and after. `timber fmt --check .` reports what
would change without writing, which is what CI runs (see
`.github/workflows/validate.yml`).

If you're generating content programmatically, import the serialiser instead of imitating
it:

```js
import { serializeDocument } from '@timber/generator';

const raw = serializeDocument({ title: 'Hello', public: true }, 'Body text.\n');
```

`serializeDocument` is the exact inverse of the generator's `parseFrontMatter`, so anything
written through it is correct by construction. There is also `formatDocument(raw)` to
canonicalise a string you already have, and `isCanonicalDocument(raw)` to test one.

## Object layout

Each object is a **folder** containing `index.md` plus its own images:

```
content/
  posts/
    my-first-post/
      index.md
      diagram.png      ← referenced from the body as ![Alt](diagram.png)
```

The folder name is the **slug**, and it drives the URL. Images live beside the `index.md`
that uses them, so deleting the folder takes its images with it — no orphans.

Site-wide files that aren't owned by any one object (a logo, a profile picture) go in the
top-level `assets/` folder and are referenced from `/assets/...`.

## Front matter

The fields available are defined per content type in `config/schemas/<type>.yml`. A field
declared `required: true` must be present or the object won't validate.

Two keys are special and not declared in the schema:

- **`id`** — a stable identity used by reference fields and by `config/navigation.yml`.
  Give referenceable objects one. It must be unique across the site, and it should not
  change once other things point at it. Renaming the folder changes the URL; changing the
  `id` breaks the links.
- **`public`** — visibility. **Draft by default:** an object without `public: true` is a
  draft and the build skips it. Nothing goes live because a flag was forgotten, and a page
  cannot be made public until it validates.

A worked example:

```markdown
---
id: POST-HELLO
title: Hello world
date: 2025-01-20T16:27:19-08:00
public: true
---

The body starts here, after the blank line.
```

### YAML gotchas

- **Dates**: write them plain (`date: 2025-01-20T16:27:19-08:00`), not quoted. They are
  stored and validated as strings; the YAML parser Timber uses does not coerce them into
  timestamps. `timber fmt` will remove quotes you add.
- **Colons and `#` in values**: quote the whole value if it contains `: ` or a trailing
  `#`, or YAML will misread it.
- **Don't hand-wrap long values.** Let `timber fmt` decide where lines break, or your file
  won't match what the editor writes.

## Images in the body

Use the `figure` directive rather than a bare Markdown image when you want a caption or a
specific layout:

```markdown
:::figure{layout="wrap-right" size="md"}
![A description of the image](photo.jpg)

An optional caption.
:::
```

`layout` is one of `full-width`, `wrap-left`, `wrap-right`, `center`; `size` is `sm`, `md`
or `lg`. **Alt text is mandatory** — an image without it will fail validation.

## Before you commit

```sh
timber validate .     # schemas, required fields, references, duplicate ids
timber fmt --check .  # every object matches what the editor writes
```

Both are run by `.github/workflows/validate.yml` on pull requests and on pushes to any
branch other than `main` and `*_wip`.

A workflow only *reports* a result, though — it can't refuse a push by itself. To make a
failing check actually block a merge, mark **Validate content** as a required status check
on your default branch; the steps are in Timber's
[`INSTALL.md` §2.6](https://github.com/TimAidley/Timber/blob/main/INSTALL.md).
