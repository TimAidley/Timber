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
| `@timber/jekyll-compat` | **Theme-import core + Jekyll engine** (SPEC §2 → Tier A): the shared, engine-pluggable `planThemeImport` (theme files → repo write-set) + the `ThemeEngine` seam + `setFrontMatterScalar`, plus the Jekyll engine (`importJekyllTheme` transform, `registerJekyllCompat` ecosystem filters/tags). Reads `page.*` | browser and Node |
| `@timber/eleventy-compat` | **Eleventy engine + the runtime dispatch** (SPEC §2 → Tier A): the `importEleventyTemplate` transform, `eleventyEngine` (collects `_includes/**` at any input-dir prefix, parses `_data/*.json` globals), `registerEleventyCompat` (`url`/`slugify`/…), `detectEngine`, and `themeRuntime`/`parseThemeManifest` (the one place that maps a theme's `theme.json` → render mode for *both* engines, so it depends on jekyll-compat). Only **Liquid**-authored Eleventy themes | browser and Node |
| `@timber/sass` | **Isomorphic SCSS compiler** (SPEC §6): `compileScss` — dart-sass driven by an **in-memory importer** over the repo snapshot, so the browser preview and the Node build compile stylesheets identically (preview ≡ build). dart-sass is pure JS; lazy-loaded in the browser | browser and Node |
| `@timber/cli` | `timber build . _site` — builds the whole static site | Node (CI) |
| `@timber/app` | The browser editor SPA (React): auth, editor, preview, media pipeline | browser |
| `@timber/host` | The **host-provider port**: host-neutral types + the `HostProvider` interface (`HostRepo` + `HostIdentity` + optional `DeployBackend`) the editor depends on, so a git host is a swappable adapter. Also `describeHostError()` — the one place that turns *any* adapter's throw into a cause the UI can act on (SPEC §11) | browser and Node |
| `@timber/github` | **A `HostProvider` adapter** — `RepoClient` (Octokit): load/commit via the Git Data API, read/dispatch workflow runs | browser |
| `@timber/gitea` | **A second `HostProvider` adapter** — `GiteaClient` for Gitea/Forgejo (Codeberg), over the Gitea REST API via `fetch` (no SDK). Proves the port is host-neutral | browser |
| `@timber/gitlab` | **A third `HostProvider` adapter** — `GitLabClient` over the GitLab REST API v4 via `fetch`, with a real pipelines-based `DeployBackend` | browser |
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
only on the port everywhere else. Three adapters exist: **`@timber/github`** (`RepoClient`,
Octokit), **`@timber/gitea`** (`GiteaClient`, Gitea/Forgejo/Codeberg, over `fetch`), and
**`@timber/gitlab`** (`GitLabClient`, over `fetch`); a site picks one via `config.host`
(`github` default, or `gitea`/`gitlab` + an `apiBaseUrl`). Adding a fourth means a new
adapter + a branch in that factory — nothing else.

The Gitea and GitLab adapters were built specifically to prove the port isn't GitHub-shaped,
and it holds: each `implements HostProvider` with a completely different HTTP model, and no
adapter has required a change to `@timber/host`. Where the hosts diverge, the **adapter**
absorbs it and the port stays clean — a map of where the abstraction earns its keep:

| Concern | GitHub | Gitea | GitLab | Port stays neutral because… |
|---|---|---|---|---|
| Commit | blob→tree→commit overlay | one **ChangeFiles** call | Commits API `actions[]` | `commitFiles` takes a write-set; the adapter classifies create-vs-update against the branch tree |
| Move | reuse blob sha server-side | read + re-upload | **native server-side `move`** | `MoveEntry.sha` is an **opaque content handle**, not "a GitHub blob sha" |
| Publish | compose a squashed tree | **replay** the change-set | **replay** the change-set | `publishSquash` carries the plan; Gitea/GitLab ignore `wipTip`/`strategy` |
| Changed paths | `compare` file list | **tree-diff** by path+sha | `compare` file list (**rename-aware**) | callers only need added/modified/removed(/renamed) |
| Reset WIP | force-update ref | force-update ref | **delete + recreate** (no force-update) | `resetBranch` is intent, not a ref-update primitive |
| Deploy | GitHub Actions | **none** (Codeberg Pages is branch-based) | **CI/CD pipelines** | `DeployBackend` is optional; GitLab implements it, Codeberg omits it |
| Deploy **progress** | Actions **steps** within jobs | — | pipeline **jobs** (coarser label) | progress is measured in *elapsed time vs a typical run*, never counted steps — so a coarser host label costs the label, not the bar |
| Addressing | `owner`/`repo` | `owner`/`repo` | URL-encoded **project path** (nested groups) | the port has no `owner`/`repo`; it's adapter construction config |

The port is split by capability so a host provides what it can:

| Capability | Interface | Notes |
|---|---|---|
| Read/write git content + **publish** | `HostRepo` | Always required. Publish is the intent-level `publishSquash()` — the app computes the *plan* (validity gate, clean-vs-rebase, conflict detection, all host-neutral); the adapter owns the host-specific mechanics of building the squashed commit (GitHub's blob→tree→commit model stays inside `@timber/github`). Also exposes repo **visibility** via `getVisibility()` → `public` / `private` / `unknown` (the last for a host that can't report it — both shipped adapters do). |
| Who is signed in | `HostIdentity` | `getAuthenticatedLogin()` drives the per-user `<login>_wip` branch (SPEC §11). |
| Trigger/observe a build | `DeployBackend` (**optional**) | `getLatestDeploy()` / `triggerDeploy()`. A host with **no CI** omits it, and the editor degrades — no publish-status morph, no out-of-date banner. GitHub maps it onto the `deploy.yml` workflow; **GitLab** onto CI/CD **pipelines** (a real second implementation); Codeberg omits it (branch-based Pages, no run to observe). |
| Report **build progress** | `getTypicalDeployDurationMs()` / `getDeployProgress()` on `DeployBackend` (**optional within an optional capability**) | Feeds the banner's progress bar + ETA and the Publish button's fill (SPEC §12). Adapters return only facts (a typical duration, what's executing now); the *presentation* — fill, wording, cap, overrun, queued — is the app's (`state/deploy.ts`), so it can't drift per host. Implement neither and the editor shows the previous plain `Building…`; a failing call degrades the same way and never breaks the status leg beside it. |

**Concurrency on the WIP branch is handled in two places, on purpose.** The *ref race* is
the adapter's problem — `commitFiles` re-reads the moved tip, rebuilds its overlay and
waits out a lagging ref read (`packages/github/src/client.ts`), so concurrent writes to
different files never reach the UI at all. The *content* hazard is the app's problem —
two tabs editing the same file overwrite each other with no error — so the editor keeps a
per-tab record of the commits it landed (`state/ownWrites.ts`, a `Proxy` over the port so
every write path is covered) and watches the tip for anyone else's
(`state/foreignChanges.ts` → a warning + per-file diffs). The own-write record is also an
**event source**: `OwnWrites.subscribe` fires on every recorded commit, and the editor's
saved-state refresh (the `main…wip` compare behind the "Saved" badges and the Publish
gate) listens to it — so the counts follow every commit, whichever feature landed it.
*Adding a new commit path → nothing to do; it's recorded automatically and the change
counts refresh automatically. Changing what counts as a clash → also update
`components/ForeignChanges.tsx` and SPEC §11.*

**Failures are normalised in the port, not in the UI.** Each adapter throws its own shape — Octokit's `RequestError`, the Gitea/GitLab `fetch` errors, a bare `TypeError` offline — so `describeHostError()` (`@timber/host`) maps all of them onto one small vocabulary (*auth · permission · not-found · rate-limit · conflict · too-large · invalid · network · server*) plus a reason, a hint, and **whether a retry could work**. The editor's diagnostics log (`packages/app/src/state/diagnostics.ts` — a bounded, redacted, in-memory ring buffer) and the header's save-status both read that verdict, so **adding a fourth adapter needs no UI change**: give the thrown error a `status` (and, if you can, an Octokit-shaped `response.headers` + body `message`) and every failure surface reports it correctly. *Change the vocabulary → also update the badge in `components/ChangeBadges.tsx` and SPEC §11.*

**Page hosting is host-neutral in the generator.** It turned out nothing GitHub-specific
had to move: the **base path** is derived from the site's configured `baseUrl`
(`@timber/content` `seo.ts`) — `you.github.io/<repo>`, `you.codeberg.page/<repo>`, a custom
domain, all just work — and the **meta-refresh redirect stubs** (`redirects.ts`) work on any
static host. Only the *deploy mechanism* is per-host, and it lives entirely in the
site-template, not the app or generator: `.github/workflows/deploy.yml` uploads a Pages
artifact (GitHub), `.forgejo/workflows/deploy.yml` force-pushes to the `pages` branch that
**Codeberg** Pages serves, and `.gitlab-ci.yml`'s `pages` job publishes a `public/` artifact
to **GitLab** Pages. All three co-host the editor at `/<repo>/edit/` and coexist in one
template (each host ignores the others' workflow files).

**Git host and deploy target are separate axes.** The deploy target isn't forced to match
the git host: a **GitHub**-hosted site can deploy to **Cloudflare Pages** instead of GitHub
Pages, via a `TIMBER_DEPLOY_TARGET=cloudflare` variable on `deploy.yml` — GitHub Actions
still builds and then publishes with `wrangler pages deploy` (so the editor's Actions-run
publish status is unchanged; only the served root differs, `<project>.pages.dev` at `/`, so
the editor sits at `/edit/`). The git host (adapter, WIP branches, commit loop) is untouched.

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
**Gitea/Forgejo (Codeberg)** or **GitLab** site, set `GITEA_BASE_URL` (e.g.
`https://codeberg.org`) or `GITLAB_BASE_URL` (e.g. `https://gitlab.com`) — the broker then
relays to that instance as a public client, and `OAUTH_CLIENT_SECRET` is optional.

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
- **The change lifecycle (editing → saved → published, SPEC §8/§11) is fed by two
  invariants — keep both total.** (1) The autosaver's dirty union
  (`state/autosave.ts` `notifyDirtyPaths`) spans EVERY dirty collection — objects, raw
  files, staged assets, deletions, moves; a new kind of pending change joins the union
  or it's invisible until it reaches the branch (that bug shipped twice: advanced files,
  then assets). Invalid advanced drafts (uncommittable, but kept + resurfacing on reload)
  are unioned in by the editor (`useAdvanced.invalidDraftPaths`). (2) The saved set is a
  **derivation of the branch**, recomputed on every tip movement — own commits via the
  `OwnWrites.subscribe` event (see the concurrency note above), foreign ones via the
  watcher — never hand-invalidated per call site. Classification (object vs colocated
  asset vs site file) goes through the **one path grammar**
  (`@timber/content` `paths.ts` — `parseObjectPath` & friends); never write a second
  `content/...` regex, that drift is how deleted translations went missing.
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
- **Pagination** (SPEC §13 → Pagination) → the logic is one pure module, `@timber/content`
  `pagination.ts` (`parsePaginate`/`validatePaginate`, `pageUrl`, `paginateEntries`,
  `paginateObject`, `paginatedSeo`) + its `PageSeoOptions` hook in `seo.ts` (`url` /
  `titleSuffix`, which also removed the build's homepage-canonical special case) + the
  `paginate` check wired into `validate.ts`. The render side is `@timber/generator`
  (`paginator` on `RenderPageInput`, exposed top-level — deliberately **undefined**, not
  `{}`, so `{% if paginator %}` is false on ordinary pages). **Both callers loop over the
  pages and must stay in lockstep** — `packages/cli/src/build.node.ts` (writes N
  `index.html`) and `packages/app/src/preview/renderSitePage.ts` (renders page 1 from the
  *live* front matter) — plus the default theme
  (`site-template/themes/default/templates/default.liquid` listing +
  `pagination.liquid` pager + `.listing`/`.pagination` in `theme.css`) and
  `docs/pagination.md`. Change the URL shape or the paginator's keys → update the theme,
  both callers, the docs, and SPEC §13 together.
- **Where the site is served from** → one value, `baseUrl` in the settings singleton, which
  `@timber/content`'s `siteContext` turns into `site.basePath` (`/repo`, or `''` for a root
  site or custom domain). On GitHub Pages a root-level **`CNAME`** file is the second half of
  that switch: `deploy.yml` copies it into `_site` (which is how Pages learns the domain) and
  uses its presence to build the editor for `/edit/` rather than `/<repo>/edit/`. The two must
  agree — a `CNAME` without a matching `baseUrl` gives every in-page link a stray `/<repo>/`.
  Change either → INSTALL.md §2.4 and `site-template/.github/workflows/deploy.yml`.
- **Preview asset resolution** → the preview frame can't fetch the repo, so
  `packages/app/src/preview/renderSitePage.ts` (`assetRepoPath`) maps each image reference
  back to the repo path `AssetStore` keys on, then swaps in a blob URL. Three shapes:
  relative (resolve against the edited object's bundle), `/assets/**` (a repo path once the
  base path and leading slash come off), and another object's colocated file arriving via a
  listing excerpt (`/posts/x/photo.jpg` → looked up through the model's URL index). Add a
  new way for an asset reference to reach a page → teach `assetRepoPath` about it, or it
  renders broken in preview while being fine on the built site.
- **Body links** (SPEC §6 → Links inside a Markdown body) → `@timber/generator`'s
  `links.ts` (`rebaseHtml`: `basePath` onto root-relative refs, `base` to resolve relative
  ones). `renderPage` applies it to every body with `site.basePath`; `attachExcerpts` applies
  it with both options. Change the rule → both call sites and SPEC §6.
- **Listing excerpts** (SPEC §6 → Collections in templates) → the split + render live in
  `@timber/generator` (`excerpt.ts`: `splitExcerpt` cuts the Markdown source at `<!--more-->`
  or the first paragraph, `renderExcerpt` runs the prefix through the normal pipeline and
  `links.ts`'s `rebaseHtml` re-points its references). `@timber/content`
  (`collections.ts` `attachExcerpts`) puts `excerpt`/`truncated` on each entry — it is
  **async**, unlike `assembleCollections`, and takes the site's `basePath`. **Both callers
  must call it right after assembling** — `packages/cli/src/build.node.ts` and
  `packages/app/src/preview/renderSitePage.ts` — or the preview and the build disagree about
  what a listing shows. Change the cut rule → update both callers, `site-template/AUTHORING.md`
  (authors need to know the marker) and SPEC §6 together.
- **Multilingual / i18n** (SPEC §5 → Multilingual) → the model side is `@timber/content`
  (`assemble.ts` lang/path parsing + translation index, `references.ts` `urlFor`/
  `translationsOf`, `collections.ts` per-entry `lang`, `seo.ts` `hreflangAlternates`);
  the render side threads `lang`/`translations` through `@timber/generator` `renderPage`
  into **both** callers — `packages/cli/src/build.node.ts` and
  `packages/app/src/preview/renderSitePage.ts` (keep them in lockstep for preview ≡ build)
  — plus `site-template/themes/default/templates/default.liquid` (`<html lang>`, hreflang, switcher). The
  editor side is `packages/app` (`content/newObject.ts` + `content/newTranslation.ts`,
  `state/autosave.ts` `markObjectCreated`, `Editor.tsx` add-translation flow +
  `byTranslation` rebuild, `components/AddTranslationDialog.tsx`, `components/ContentList.tsx`
  language chip). A site opts in via `languages`/`defaultLanguage` in its settings singleton.
- **Theme compatibility, engine-pluggable** (SPEC §2 → Tier A) → the native template-contract
  pieces are in `@timber/generator` (`urlFilters.ts` `relative_url`/`absolute_url`; `render.ts`
  `page.url`/…/`layout` + the **data cascade** `globals`/`flattenData`; the `extend` seam) and
  `@timber/content` (`collections.ts` `withCollectionAliases`). The import is **engine-pluggable**:
  the shared `planThemeImport` (`packages/jekyll-compat/src/planImport.ts`, theme files → repo
  write-set) takes a **`ThemeEngine`** — `jekyllEngine` (`_layouts`/`_includes` → templates,
  reads `page.*`) or `eleventyEngine` (`@timber/eleventy-compat`: `_includes/**` at any input-dir
  prefix → templates, `_data/*.json` → globals, `name:'eleventy'`). To add an engine: implement
  `ThemeEngine.collect` + optional `name`/`globals`; touch nothing else. A non-native engine
  makes the plan write a **`themes/<name>/theme.json` manifest** (engine + `_data` globals). At
  render time, **`themeRuntime(manifest)`** (in `@timber/eleventy-compat`, the one place that
  knows both engines) maps it to `{ extend, flattenData, globals }`; BOTH `build.node.ts` and the
  preview (`renderSitePage.ts`, manifest loaded by `siteTheme.ts`) use it, so preview ≡ build —
  an Eleventy theme's bare `{{ title }}`/`{{ metadata.* }}` resolve, a native/Jekyll theme reads
  `page.*` unchanged. **SCSS** compiles **isomorphically** (`@timber/sass`, in-memory importer)
  in build + preview over the active theme's `_sass` load path — keep them in lockstep. The
  **adopt-once** flow runs from two edges: the CLI (`packages/cli/src/importTheme.node.ts`, fs →
  files, `--engine`/autodetect via `detectEngine`) and the **browser**
  (`packages/app/src/theme/importTheme.ts`: `fflate` unzip → plan → `commitFiles`; UI in
  `components/ImportThemeDialog.tsx` with an engine picker). Both write into a **`themes/<name>/`
  folder** (§13). **Activation** (`settings.activeTheme`) differs by edge on purpose: the CLI
  patches the file on disk (`setFrontMatterScalar` — no live editor to race), while the browser
  activates through the editor's **settings-edit pipeline** (`Editor.activateTheme` → autosave):
  the settings singleton is a live content object with one writer, and a direct commit built
  from load-time content both reverted session edits and could be undone by a queued flush.
  Guide: `docs/importing-themes.md`. **Change an engine's transform → keep the manifest's
  `engine` id, `themeRuntime`, and the render-mode wiring in lockstep.**
- **The `index.md` byte format → change it in exactly one place, and re-run `timber fmt`
  everywhere.** `serializeDocument` (`@timber/generator`, `document.ts`) is the sole writer of
  the on-disk form and the exact inverse of `parseFrontMatter` beside it; `formatDocument` /
  `isCanonicalDocument` are derived from it, `timber fmt` (`packages/cli/src/fmt.node.ts`)
  applies it to a repo, and the app's `content/document.ts` is now a **re-export**, not a second
  copy — `reassembleDocument` is that alias, so the editor cannot drift from the CLI. If you
  change the format, you must also re-normalize **`site-template/content/**`** and every
  **test fixture** (`packages/{cli,content}/test/fixtures/*`), or every site created from the
  template ships an object that the editor immediately reports as modified. The rule and its
  failure mode are documented for site owners in `site-template/AUTHORING.md` + `AGENTS.md`,
  and enforced by `site-template/.github/workflows/validate.yml`. **Keep `fmt` out of
  `validate`:** a non-canonical object is valid, and merging the two would report a working
  page as broken.
- **Themes as folders → also update the resolver + every advanced path helper.** Which repo
  dirs are "the theme" is one seam: **`resolveThemePaths(activeTheme, exists)`** in
  `@timber/content` (`themePaths.ts`) → `{ templatesDir, assetsDir, sassLoadPaths }`, plus
  `assetSourceDirs`/`assetOutputPath` (theme assets publish to `/assets`; root `assets/` uploads
  override on a clash) and `LEGACY_THEME` (the pre-themes root). The **build** (`build.node.ts`),
  the **preview** (`siteTheme.ts`/`useSiteTheme.ts`/`Editor.tsx`), and the whole **advanced area**
  scoped to the active theme — `loadAdvancedFiles`/`kindOf`, `newFile.ts`, `reconcileDrafts.ts`,
  `media/{siteAssets,assetName,assetReferences}.ts` — all take a `ThemePaths` (Editor resolves it
  once from `activeTheme` and threads it). The **Themes panel** (`advanced/ThemeManager.tsx`,
  discovery in `theme/themeFolders.ts`) switches via the editor's settings-edit pipeline
  (`onSwitch` → `Editor.activateTheme`; see the theme-import bullet — one writer for settings)
  and deletes (`commitFiles` the folder's paths) on the WIP branch. Add a theme-scoped path
  anywhere → resolve it through `resolveThemePaths`, never a hardcoded
  `templates/`/`assets/` literal.
- **The site scaffold** (theme, schemas, sample content, workflows) → edit **`site-template/`**
  only; the mirror regenerates the template repo. Never edit `Timber-site-template` directly.
- **Setup instructions** → **`INSTALL.md`** only (canonical); the template's README is a stub.
- **Auth flow / mode** → `host/{auth,oauth,deviceFlow,token}.ts` + the sign-in components
  + `docs/auth-github-app.md`.
- **The Timber wordmark → keep the two font copies in lockstep.** The brand wordmark renders in two
  documents from two copies of the **subsetted Fraunces face** (`fraunces-timber.woff2`, OFL-1.1):
  the **editor chrome** (`@timber/app` — `components/Wordmark.tsx` + `.wordmark` rules and `@font-face`
  in `src/styles.css`, font in `src/fonts/`) and **published sites** via the **`:timber-logo`
  shortcode** (SPEC §7 → Brand wordmark). The shortcode is **self-contained**, NOT theme-owned: the
  shared generator's directive transform (`packages/generator/src/figureDirective.ts`, span-class
  allowance in `markdown.ts`) emits the `<span class="wordmark">…` markup, and `injectWordmarkStyle`
  (`wordmarkStyle.ts`) adds the `.wordmark` rules + an `@font-face` with the font
  **base64-embedded** (`wordmarkFont.ts`). That injection runs **per page** — `renderPage` applies it
  to the assembled document — not per Markdown document, because a wordmark can arrive from a body,
  a listing **excerpt**, or a settings field rendered with **`markdownify`** (`contentFilters.ts`),
  and every route needs the same `<style>` exactly once. This is deliberate — brand styling that must match on every
  site can't live in each site's `theme.css` (it drifts/goes stale), so it ships from the version-pinned
  generator and works on existing sites with zero theme changes. The embedded base64 is generated from
  the app's canonical woff2 by **`scripts/gen-wordmark-font.mjs`** → `generator/src/wordmarkFont.ts`.
  Change the font file, the classes, or the "Tim"/"ber" split → update the app copy **and** rerun the
  script so header ≡ shortcode. (The default theme carries no wordmark CSS or font — the generator owns it.)
  The **colours** are in lockstep the same way: the shortcode hard-codes the editor chrome's `--text` /
  `--text-muted` values (`app/src/styles.css`, light + dark) rather than following the site's `--fg` /
  `--muted`, because a logo has to hold its two-tone contrast even in muted text like a footer. Change
  those tokens in the app → update `WORDMARK_CSS` to match. Dark inversion is `light-dark()`, keyed to
  the page's declared `color-scheme`; `--wordmark-ink` / `--wordmark-muted` override it per section.
