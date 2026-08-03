# **Tim**ber

**Tim**ber is a **git-backed static CMS** — a lightweight, friendly-to-edit alternative to other static site
generators that produces a **static website** deployed to GitHub Pages, but is still **editable in 
a browser**. Site owners define their own content types, edit content in an in-browser editor, and
publish by committing to a GitHub repo. Self-hosted, single-tenant, no database, no server-side app.

## Simple comparisons

| System | Needs a server | Easy editing | Text-based markdown editing | User Authentication | Vibe coded |
|--------|----------------|--------------|-----------------------------|------------|-------|
| **Tim**ber | No* | Yes | Yes | via GitHub | Yes |
| Wordpress | Yes | Yes | No(?) | Built - in | No |
| Hugo / Eleventy / Astro etc | No | No | Yes | depends | No | 

***Tim**ber may require a very tiny authentication broker depending on how you want to set up the login flow.
The broker can be run for free on Cloudflare as a Cloudflare worker. 

## Documentation

| Doc | What it's for |
|---|---|
| **[Setup guide](https://timaidley.github.io/Timber/install.html)** | **Set up a hosted site** — pick your git host, sign-in method and deploy target and it shows only the steps you need. No local tooling. Source: [`docs/install.html`](docs/install.html). |
| **[INSTALL.md](INSTALL.md)** | The same guide as a printable document — every path shown, each block labelled with the choices it applies to. **Generated** from the page. |
| **[DEVELOPMENT.md](DEVELOPMENT.md)** | **Run Timber locally** or hack on it — run the editor on your machine, build a site by hand, deploy the broker directly. |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | How the pieces fit — repos, packages, the dependency graph, auth modes, the workflows. |
| **[SPEC.md](SPEC.md)** | The authoritative design and rationale. |

## What you get

A public website at `https://<you>.github.io/<repo>/` plus an in-browser editor co-hosted at
`/<repo>/edit/`. The editor signs in to GitHub (paste-a-PAT, or a GitHub App via a redirect
or device flow — see the [setup guide](https://timaidley.github.io/Timber/install.html)), commits your edits, and a GitHub Action
rebuilds and deploys the site.

## Repo layout

- `packages/` — the monorepo: `generator` (render core), `content` (content model), `cli`
  (Node site build), `app` (browser editor), `github` (repo client), `oauth-broker`
  (Cloudflare Worker).
- `site-template/` — the example site scaffold; mirrored to the `Timber-site-template` repo
  (edit it here, never there).
