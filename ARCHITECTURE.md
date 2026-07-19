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
| `@timber/jekyll-compat` | **Jekyll-theme import layer** (SPEC §2 → Tier A): the `importJekyllTheme` transform + `registerJekyllCompat` ecosystem filters/tags, plugged into the generator via its `extend` seam. Lets Tier-A (Liquid+CSS) Jekyll themes be imported and rendered by Timber's own generator | browser and Node |
| `@timber/cli` | `timber build . _site` — builds the whole static site | Node (CI) |
| `@timber/app` | The browser editor SPA (React): auth, editor, preview, media pipeline | browser |
| `@timber/host` | The **host-provider port**: host-neutral types + the `HostProvider` interface (`HostRepo` + `HostIdentity` + optional `DeployBackend`) the editor depends on, so a git host is a swappable adapter | browser and Node |
| `@timber/github` | **A `HostProvider` adapter** — `RepoClient` (Octokit): load/commit via the Git Data API, read/dispatch workflow runs | browser |
| `@timber/gitea` | **A second `HostProvider` adapter** — `GiteaClient` for Gitea/Forgejo (Codeberg), over the Gitea REST API via `fetch` (no SDK). Proves the port is host-neutral | browser |
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

## The git host — the `HostProvider` seam

Everything the editor does against a git host — load content, commit edits to the WIP
branch, publish (squash WIP→main), watch the deploy — flows through **one port**,
`HostProvider` (`packages/host`). The app constructs a concrete adapter in exactly one
place — `createHostProvider()` (`packages/app/src/host/hostProvider.ts`) — and depends
only on the port everywhere else. Two adapters exist: **`@timber/github`** (`RepoClient`,
Octokit) and **`@timber/gitea`** (`GiteaClient`, Gitea/Forgejo/Codeberg, over `fetch`); a
site picks one via `config.host` (`github` default, or `gitea` + an `apiBaseUrl`). Adding
GitLab/self-hosted later means a new adapter + a branch in that factory — nothing else.

The Gitea adapter was built specifically to prove the port isn't GitHub-shaped, and it
holds: `GiteaClient implements HostProvider` with a completely different HTTP model. Where
the hosts diverge, the **adapter** absorbs it and the port stays clean — a useful map of
where the abstraction earns its keep:

| Concern | GitHub adapter | Gitea adapter | Port stays neutral because… |
|---|---|---|---|
| Commit | blob→tree→commit overlay | one **ChangeFiles** call (create/update/delete ops) | `commitFiles` takes a write-set; the adapter classifies create-vs-update against the branch tree |
| Move | reuse blob sha server-side | read the bytes and re-upload | `MoveEntry.sha` is documented as an **opaque content handle**, not "a GitHub blob sha" |
| Publish | compose a squashed tree | **replay** the WIP change-set onto main | `publishSquash` carries the plan; Gitea ignores `wipTip`/`strategy` (GitHub tree concerns) |
| Changed paths | `compare` returns a file list | **diff the two trees** by path+sha | callers only need added/modified/removed (a rename reads as add+remove) |
| Deploy | GitHub Actions (`deploy.yml`) | **none** — Codeberg Pages is branch-based | `DeployBackend` is optional; the editor degrades when it's absent |

The port is split by capability so a host provides what it can:

| Capability | Interface | Notes |
|---|---|---|
| Read/write git content + **publish** | `HostRepo` | Always required. Publish is the intent-level `publishSquash()` — the app computes the *plan* (validity gate, clean-vs-rebase, conflict detection, all host-neutral); the adapter owns the host-specific mechanics of building the squashed commit (GitHub's blob→tree→commit model stays inside `@timber/github`). Also exposes repo **visibility** via `getVisibility()` → `public` / `private` / `unknown` (the last for a host that can't report it — both shipped adapters do). |
| Who is signed in | `HostIdentity` | `getAuthenticatedLogin()` drives the per-user `<login>_wip` branch (SPEC §11). |
| Trigger/observe a build | `DeployBackend` (**optional**) | `getLatestDeploy()` / `triggerDeploy()`. A host with **no CI** omits it, and the editor degrades — no publish-status morph, no out-of-date banner — instead of assuming GitHub Actions + Pages. GitHub maps it onto the site-template's `deploy.yml` workflow. |

**Page hosting is host-neutral in the generator.** It turned out nothing GitHub-specific
had to move: the **base path** is derived from the site's configured `baseUrl`
(`@timber/content` `seo.ts`) — `you.github.io/<repo>`, `you.codeberg.page/<repo>`, a custom
domain, all just work — and the **meta-refresh redirect stubs** (`redirects.ts`) work on any
static host. Only the *deploy mechanism* is per-host, and it lives entirely in the
site-template, not the app or generator: `.github/workflows/deploy.yml` uploads a Pages
artifact (GitHub), while `.forgejo/workflows/deploy.yml` builds and force-pushes to the
`pages` branch that **Codeberg** Pages serves. Both co-host the editor at `/<repo>/edit/`;
they coexist in one template (GitHub ignores `.forgejo/`, Forgejo ignores `.github/`).

## Authentication — the `getToken()` seam

Everything auth flows through one seam (`packages/app/src/host/auth.ts` picks the mode;
the rest of the app only ever calls `getToken()`). The host-specific bits of sign-in —
the "Sign in with X" label, the OAuth authorize endpoint, where to create a token — come
from a **host descriptor** (`host/hostDescriptor.ts`, derived from `config.host`), so a
Codeberg/Gitea site presents its own host instead of a hardcoded "GitHub". Sign-in works on
either host: PAT (host-neutral), or **OAuth** — for Gitea the broker runs in `GITEA_BASE_URL`
mode as a **secret-less relay** (Gitea allows public PKCE clients; the relay exists only
because the instance sends no CORS). The rest of this section describes the **GitHub**
flow (the default); the three interchangeable modes are:

| Mode | Server needed | Client secret | UX | Selected when |
|---|---|---|---|---|
| **PAT** | none | none | paste a fine-grained token | no client id / broker configured |
| **OAuth redirect** | broker (holds secret) | yes | "Sign in with GitHub" → redirect | client id + broker set, `flow` ≠ device |
| **Device flow** | broker as **secret-less relay** | none | show a code → approve on github.com | client id + broker set, `flow: device` |

Why the broker exists at all: GitHub's token endpoint needs the client secret **and**
sends no CORS, so a static SPA can't finish OAuth alone. The GitHub *API* (`api.github.com`)
*does* send CORS, which is why the PAT path needs no server. Device flow removes the
secret but still needs the relay (GitHub's device endpoints also lack CORS).

There's a second seam, `canAccessAdvanced()` (`host/access.ts`, returns `true`), gating
the template/config "advanced" area — where real roles slot in later.

## Configuration — how values reach the editor

`packages/app/src/host/config.ts` (`resolveConfig`) resolves config with this precedence:

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
Actions-side names use the `GH_`/plain prefix because GitHub **reserves** `GITHUB_`. For a
**Gitea/Forgejo (Codeberg)** site, set `GITEA_BASE_URL` (e.g. `https://codeberg.org`) — the
broker then relays to that instance as a public client, and `OAUTH_CLIENT_SECRET` is optional.

**Timber repo**: `TEMPLATE_SYNC_TOKEN` (fine-grained PAT, Contents R/W on
`Timber-site-template`) for the mirror.

## Editing / publishing data flow

`main` holds **source only** — built HTML never enters git. In the editor, edits autosave
to IndexedDB and — for objects at storage level **Backed up** — a per-user
**`<username>_wip`** branch (debounced, coalesced commits). Objects the author keeps
**On this device** (SPEC §5/§8) stay in IndexedDB only and are held out of the WIP stream.
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
- **Editor build provenance** (the out-of-date banner, SPEC §12) is baked as **build
  vars** (`VITE_TIMBER_UPSTREAM_REPO` / `_UPSTREAM_REF` / `_BUILD_SHA`), *not* runtime
  config — it describes the build, so it can't come from a site's `config.js`. Touch
  points: `packages/app/vite.config.ts` (the `timber-build-provenance` plugin stamps
  them from git HEAD + repo/ref defaults, so the banner works without a workflow change)
  + `host/buildInfo.ts` (resolve) + `state/upstreamVersion.ts` +
  `components/UpdateBanner.tsx` + `site-template/.github/workflows/deploy.yml` (optional
  explicit overrides) + `packages/app/.env.example`.
- **The two-axis status model** (storage: On this device ⇄ Backed up; publication:
  Draft/Public — SPEC §5/§8/§11) → `packages/content/src/visibility.ts` (publication flag)
  + `packages/app/src/state/changes.ts` (per-object state) + the autosave WIP-commit filter
  (device-only objects excluded) + `packages/app/src/components/ChangeBadges.tsx` and the new
  location-readout component + the host seam's **`HostRepo.getVisibility()`**
  (`public`/`private`/`unknown`; both adapters report it) for the privacy label + the
  New-object dialog's create-time storage choice. The readout's website stop keys off the
  optional `DeployBackend` capability (absent host — e.g. Gitea/Codeberg — ⇒ no stop).
  Storage level is **device-local metadata**
  (IndexedDB), publication is **front matter** — keep the two in their separate homes.
- **Multilingual / i18n** (SPEC §5 → Multilingual) → the model side is `@timber/content`
  (`assemble.ts` lang/path parsing + translation index, `references.ts` `urlFor`/
  `translationsOf`, `collections.ts` per-entry `lang`, `seo.ts` `hreflangAlternates`);
  the render side threads `lang`/`translations` through `@timber/generator` `renderPage`
  into **both** callers — `packages/cli/src/build.node.ts` and
  `packages/app/src/preview/renderSitePage.ts` (keep them in lockstep for preview ≡ build)
  — plus `site-template/templates/default.liquid` (`<html lang>`, hreflang, switcher). The
  editor side is `packages/app` (`content/newObject.ts` + `content/newTranslation.ts`,
  `state/autosave.ts` `markObjectCreated`, `Editor.tsx` add-translation flow +
  `byTranslation` rebuild, `components/AddTranslationDialog.tsx`, `components/ContentList.tsx`
  language chip). A site opts in via `languages`/`defaultLanguage` in its settings singleton.
- **Jekyll theme compatibility** (SPEC §2 → Tier A) → the native template-contract pieces are
  in `@timber/generator` (`urlFilters.ts` `relative_url`/`absolute_url`; `render.ts`
  `page.url`/`page.collection`/`page.content`/`layout`; the `createEngine`/`renderPage` `extend` seam)
  and `@timber/content` (`collections.ts` `withCollectionAliases`); the compat layer proper is
  `@timber/jekyll-compat` (`importTheme.ts` transform + `filters.ts`/`tags.ts` +
  `register.ts`). A consumer renders an imported theme with
  `renderPage({ …, templates: importJekyllTheme(files, root), extend: registerJekyllCompat })`.
  Escaping reconciliation (drop redundant `escape`/`xml_escape`) lives in the transform; keep
  it in lockstep with the generator's auto-escape default (SPEC §6). A theme's **SCSS** is
  compiled by a **Node/CI-side** helper — `@timber/cli`'s `compileThemeStylesheet`
  (`packages/cli/src/sass.node.ts`, dart-sass, exposed at `@timber/cli/sass`) — kept out of the
  browser bundle exactly like `sharp` (SPEC §7); the browser preview falls back to committed
  CSS. The **adopt-once** flow is `@timber/cli`'s `import-theme` command
  (`packages/cli/src/importTheme.node.ts`): transform → write `templates/*.liquid`, compile
  SCSS, copy assets. `buildSite` (`build.node.ts`) auto-passes `extend: registerJekyllCompat`
  so an adopted theme's `{% seo %}`/`date_to_xmlschema`/… build with plain `timber build`
  (the layer is additive — no built-in overrides — so native sites are unaffected). The **app
  preview** (`packages/app/src/preview/renderSitePage.ts`) registers the same, so an adopted
  theme's `{% seo %}`/filters preview ≡ build (only in-browser SCSS + non-conventional CSS
  paths fall back to committed CSS). Guide: `docs/importing-jekyll-themes.md`.
- **The site scaffold** (theme, schemas, sample content, workflows) → edit **`site-template/`**
  only; the mirror regenerates the template repo. Never edit `Timber-site-template` directly.
- **Setup instructions** → **`INSTALL.md`** only (canonical); the template's README is a stub.
- **Auth flow / mode** → `host/{auth,oauth,deviceFlow,token}.ts` + the sign-in components
  + `docs/auth-github-app.md`.
