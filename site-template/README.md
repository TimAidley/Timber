# Your Timber site

A [Timber](https://github.com/TimAidley/Timber) site: a git-backed static website with an
in-browser editor at `/<repo>/edit/`.

- **`content/`** — your pages (each is a folder with an `index.md`); `content/settings/`
  holds site-wide settings.
- **`templates/`** + **`assets/`** — the theme (Liquid templates + CSS).
- **`config/`** — content-type schemas and the top navigation.
- **`.github/workflows/`** — build/deploy to GitHub Pages, content validation, plus
  one-time broker setup.

## Editing by hand

Editing in the browser needs no special knowledge. But if you import content, script a bulk
change, or have an AI assistant write files for you, read **[`AUTHORING.md`](AUTHORING.md)**
first — content files have a canonical on-disk form, and a file that doesn't match it shows
up as permanently "modified" in the editor. `timber fmt .` fixes it;
`.github/workflows/validate.yml` checks it. ([`AGENTS.md`](AGENTS.md) is the short version
for AI assistants.)

## Setup

All setup instructions — register a GitHub App, deploy the OAuth broker, enable the
editor — live in one place: **Timber's
[`INSTALL.md`](https://github.com/TimAidley/Timber/blob/main/INSTALL.md)**.

---
<sub>This template repo is generated automatically from
[`site-template/` in the Timber repo](https://github.com/TimAidley/Timber/tree/main/site-template) —
edit it there, not here.</sub>
