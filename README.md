# Timber

A **git-backed static CMS** — a lightweight, friendly-to-edit alternative to WordPress that
produces a **static website** deployed to GitHub Pages. Site owners define their own content
types, edit content in an in-browser editor, and publish by committing to a GitHub repo.
Self-hosted, single-tenant, no database, no server-side app.

## Documentation

| Doc | What it's for |
|---|---|
| **[INSTALL.md](INSTALL.md)** | **Set up a hosted site** — create a repo from the template, choose a sign-in method, deploy. No local tooling. |
| **[DEVELOPMENT.md](DEVELOPMENT.md)** | **Run Timber locally** or hack on it — run the editor on your machine, build a site by hand, deploy the broker directly. |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | How the pieces fit — repos, packages, the dependency graph, auth modes, the workflows. |
| **[SPEC.md](SPEC.md)** | The authoritative design and rationale. |

## What you get

A public website at `https://<you>.github.io/<repo>/` plus an in-browser editor co-hosted at
`/<repo>/admin/`. The editor signs in to GitHub (paste-a-PAT, or a GitHub App via a redirect
or device flow — see [INSTALL.md](INSTALL.md)), commits your edits, and a GitHub Action
rebuilds and deploys the site.

## Repo layout

- `packages/` — the monorepo: `generator` (render core), `content` (content model), `cli`
  (Node site build), `app` (browser editor), `github` (repo client), `oauth-broker`
  (Cloudflare Worker).
- `site-template/` — the example site scaffold; mirrored to the `Timber-site-template` repo
  (edit it here, never there).
