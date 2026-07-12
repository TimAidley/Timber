# Architecture — how the pieces fit

A map of the moving parts and their dependencies. This is the **"what talks to what"**;
for the *why* behind decisions see **`SPEC.md`** (authoritative), and for *how to stand up
a site* see **`INSTALL.md`**.

---

## Repositories

| Repo | What it is | Edited? |
|---|---|---|
| **`TimAidley/Timber`** (this monorepo) | The app + generator source, all docs, and `site-template/` | Yes — the source of everything |
| **`TimAidley/Timber-site-template`** | The "Use this template" scaffold. **Generated** from `Timber/site-template/` by `sync-template.yml` | **No** — generated; edit `site-template/` instead |
| A user's **site repo** | Created from the template: content + config + theme + two workflows. **No app source.** | By the site owner (via the editor or git) |

## Packages (in the Timber monorepo)

| Package | What it is | Runs in |
|---|---|---|
| `@timber/generator` | remark/rehype → LiquidJS render core (one page) | browser **and** Node (isomorphic) |
| `@timber/content` | Content model: schemas, id→object index, reference resolution, validation, SEO, navigation, redirects, video allowlist, visibility | browser and Node |
| `@timber/cli` | `timber build . _site` — builds the whole static site | Node (CI) |
| `@timber/app` | The browser editor SPA (React): auth, editor, preview, media pipeline | browser |
| `@timber/github` | `RepoClient` (Octokit): load/commit via the Git Data API, read/dispatch workflow runs | browser |
| `@timber/oauth-broker` | Cloudflare Worker: OAuth token exchange (holds the secret) **+** device-flow relay (secret-less) | edge |

**Core principle:** the generator is **one codebase with two entry points** — the browser
preview and the Node CLI build — version-pinned together, so **preview ≡ production**.

## What a running site depends on

```
                 ┌──────────────────────────────────────────────┐
                 │  TimAidley/Timber  (monorepo)                 │
                 │  generator · content · cli · app · github ·   │
                 │  oauth-broker · site-template/ · docs         │
                 └───────────────┬──────────────────────────────┘
                                 │  sync-template.yml mirrors site-template/
                                 ▼
                 ┌──────────────────────────────────────────────┐
                 │  TimAidley/Timber-site-template (generated)   │  ← "Use this template"
                 └───────────────┬──────────────────────────────┘
                                 │  user creates their repo from it
                                 ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │  A user's SITE repo   (content + config + theme + 2 workflows)               │
  │                                                                             │
  │  deploy.yml ──┬─ checkout TimAidley/Timber@main ──► generator + editor app   │
  │               ├─ build site (CLI)  ───────────────► _site/                   │
  │               └─ build editor (app) ──────────────► _site/edit/             │
  │                                                                             │
  │  setup-broker.yml ── deploy Timber's oauth-broker ──► Cloudflare (one-time)  │
  └───────┬─────────────────────────┬──────────────────────────┬────────────────┘
          ▼                         ▼                          ▼
   GitHub Pages             Cloudflare Worker            a GitHub App
  (site at /, editor        (the broker / relay —        (sign-in; installed
   at /<repo>/edit/)        holds the client secret,     on the site repo)
                             or nothing for device flow)
```

So a live site leans on four things: **its own repo**, the **public `TimAidley/Timber`
repo** (checked out at build time — *not* forked), a **Cloudflare broker**, and a **GitHub
App**. The `TIMBER_REF` in both workflows pins which Timber version is used (`main` today;
set it to a release tag for stability).

## Authentication — the `getToken()` seam

Everything auth flows through one seam (`packages/app/src/github/auth.ts` picks the mode;
the rest of the app only ever calls `getToken()`). Three interchangeable modes:

| Mode | Server needed | Client secret | UX | Selected when |
|---|---|---|---|---|
| **PAT** | none | none | paste a fine-grained token | no client id / broker configured |
| **OAuth redirect** | broker (holds secret) | yes | "Sign in with GitHub" → redirect | client id + broker set, `flow` ≠ device |
| **Device flow** | broker as **secret-less relay** | none | show a code → approve on github.com | client id + broker set, `flow: device` |

Why the broker exists at all: GitHub's token endpoint needs the client secret **and**
sends no CORS, so a static SPA can't finish OAuth alone. The GitHub *API* (`api.github.com`)
*does* send CORS, which is why the PAT path needs no server. Device flow removes the
secret but still needs the relay (GitHub's device endpoints also lack CORS).

There's a second seam, `canAccessAdvanced()` (`github/access.ts`, returns `true`), gating
the template/config "advanced" area — where real roles slot in later.

## Configuration — how values reach the editor

`packages/app/src/github/config.ts` (`resolveConfig`) resolves config with this precedence:

```
window.__TIMBER_CONFIG__  (config.js, runtime)   >   VITE_TIMBER_*  (build vars)   >   defaults
```

- **Fork-and-go deploy** bakes config from **build vars** in `deploy.yml` (repo variables +
  the committed broker URL). It ships an **empty `config.js`**, so nothing is overridden.
- **Self-hosting** the editor (a prebuilt bundle, no build step) uses a filled-in
  **`config.js`** served next to the app — no rebuild.

The editor bundle uses a **relative base** (`./`), so the same build works at any
`/<repo>/edit/` subpath without a build-time base var.

## The workflows

**In a site repo** (shipped from `site-template/.github/workflows/`):
- **`deploy.yml`** — on push to `main`, `workflow_dispatch`, and a daily `schedule`:
  checkout content + Timber (pinned), build the site (CLI) and the editor (app), deploy to
  Pages. Reads `GH_OAUTH_CLIENT_ID` + `TIMBER_OAUTH_FLOW` variables and `.timber-broker-url`.
- **`setup-broker.yml`** — `workflow_dispatch` (one-time): deploy the broker to Cloudflare
  with the App's credentials + allowed origin, commit its URL to `.timber-broker-url`, and
  trigger a deploy.

**In the Timber repo:**
- **`sync-template.yml`** — on push to `main` touching `site-template/**`: `rsync --delete`
  `site-template/` into `Timber-site-template` and push (no-op when unchanged). Needs the
  `TEMPLATE_SYNC_TOKEN` secret.
- **`live-github-tests.yml`** — the github package's live API tests.

## Secrets & variables catalog

**Site repo** (Settings → Secrets and variables → Actions):

| Kind | Name | For |
|---|---|---|
| Variable | `GH_OAUTH_CLIENT_ID` | the App's client id (public) |
| Variable | `TIMBER_OAUTH_FLOW` | `device` to use device flow; unset = redirect |
| Variable | `TIMBER_EDITOR_PATH` | editor URL segment; unset = `edit` (→ `/<repo>/edit/`) |
| Secret | `GH_OAUTH_CLIENT_SECRET` | redirect flow only — **omit for device flow** |
| Secret | `CLOUDFLARE_API_TOKEN` | Workers Scripts: Edit |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |

**Broker** (Cloudflare Worker env, set by `setup-broker.yml`): `OAUTH_CLIENT_ID`,
`OAUTH_CLIENT_SECRET` (redirect only), `ALLOWED_ORIGINS` (comma-separated; legacy
`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`/`ALLOWED_ORIGIN` still read as fallbacks). The
Actions-side names use the `GH_`/plain prefix because GitHub **reserves** `GITHUB_`.

**Timber repo**: `TEMPLATE_SYNC_TOKEN` (fine-grained PAT, Contents R/W on
`Timber-site-template`) for the mirror.

## Editing / publishing data flow

`main` holds **source only** — built HTML never enters git. In the editor, edits autosave
to IndexedDB and a per-user **`<username>_wip`** branch (debounced, coalesced commits).
**Publish** squash-merges WIP → `main`, which triggers `deploy.yml` → the site rebuilds and
deploys to Pages as an artifact. The editor polls the deploy run to drive the Publish
button's status.

## Making a change without causing drift

Cross-cutting things and every file they touch:

- **Broker env var names / behavior** → `packages/oauth-broker/src/handler.ts` +
  `wrangler.toml` + `site-template/.github/workflows/setup-broker.yml` +
  `packages/oauth-broker/README.md` + `docs/auth-github-app.md`.
- **A new editor config value** → `config.ts` (`RepoConfig` + `resolveConfig`) +
  `site-template/.github/workflows/deploy.yml` (build var) + `public/config.js` template +
  the docs.
- **The site scaffold** (theme, schemas, sample content, workflows) → edit **`site-template/`**
  only; the mirror regenerates the template repo. Never edit `Timber-site-template` directly.
- **Setup instructions** → **`INSTALL.md`** only (canonical); the template's README is a stub.
- **Auth flow / mode** → `github/{auth,oauth,deviceFlow,token}.ts` + the sign-in components
  + `docs/auth-github-app.md`.
