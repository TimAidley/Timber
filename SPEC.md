# Git-Backed Static CMS — Product Specification

*Working title: TBD. This document captures the decisions made during design. Items explicitly left open are collected in "Open Decisions" near the end.*

---

## 1. Vision

A lightweight alternative to WordPress. It keeps WordPress's friendly editing experience but produces a **static site**, so the result is fast and the hosting is free or near-free (GitHub Pages). It gives up some of WordPress's dynamic flexibility in exchange.

The defining feature versus WordPress: instead of being locked to "pages and posts," the site owner **defines their own content types** — an `events` type with dates and locations, a `people` type with categories, and so on — and renders them with templates. Content is stored as files in a GitHub repository, edited through an in-browser interface, and deployed to GitHub Pages by a CI build.

The priority is **ease of editing, not ease of setup.** Initial setup may be mildly technical; day-to-day content editing must be genuinely easy.

---

## 2. Background & rationale

An earlier approach aimed to run an existing static site generator (e.g. Astro/VitePress/Eleventy) *inside the browser* via an in-browser Node runtime (Nodepod), to get true build-fidelity preview. That was investigated and abandoned — the in-browser-Node path was too fragile (native modules, cross-origin isolation, immature runtime, compatibility unknowns).

The pivot: rather than wrapping someone else's SSG, **build a small, owned generator** by assembling well-tested, browser-capable libraries (remark/rehype for Markdown, LiquidJS for templating). This trades away compatibility with existing SSG themes in exchange for full control, no dependency on an in-browser Node runtime, faster preview, and universal browser support. The generator is deliberately small — it's plumbing over mature libraries, not a new SSG engine.

---

## 3. Architecture & tenancy

- **Self-hosted, single-tenant, one instance per site.** Each site is driven by its own config pointed at its own content repository — no multi-tenant hosted service, no shared infrastructure, no database, no user-accounts system to operate. Important clarification: **"self-hosted" does not mean every user forks the whole application.** The app is a static client-side bundle published as **versioned, pinnable releases** (a tagged build on a CDN or package registry). Using it for a site means a **thin deployment** — a small host page that loads a *specific pinned version* plus that site's config — not a copy of the source. Forking is reserved for people who want to *modify* the app; it is not a prerequisite for using it.
- **Independence is a spectrum, lightest first:** reference a pinned CDN/registry build → vendor the built bundle at a pinned version into your own deployment (no CDN dependency, still no source copy or build step) → fork the source (full control, modify-only). The default is one of the first two.
- **Primary user is the builder.** Built first and foremost for personal use. Being open-source and modifiable (the fork path) is a welcome bonus, not a design constraint — and keeping the generic app cleanly separated from any one site's content keeps "someone else runs it for their site" a free option.
- **Key freedom this buys — via version pinning, not forking:** because each site references a *pinned* version, the author can change the app and cut new releases freely without touching anyone who hasn't opted in. A site keeps running its pinned version until its owner deliberately bumps it. (This is the same pinning discipline the generator already uses across preview and CI — now applied to the app itself.)
- **Two repositories, connected only by authorization** (not by any git-level link):
  - **App repo** — the generic CMS application code, published as versioned static bundles. A site loads a pinned build; it does not need a per-site copy. Knows nothing about any specific site until pointed at one.
  - **Content repo(s)** — one per site. Holds content, templates, assets, and config. This is the source of truth, and the natural home for the thin host page and the app-version pin.

---

## 4. Repository structure (content repo)

Content uses a **folder-per-object ("bundle")** layout: each object is a folder containing an `index.md` (YAML front matter + Markdown body) plus its colocated assets.

```
content/
  events/
    summer-fete/
      index.md
      hero.jpg
  people/
    jane-smith/
      index.md
      headshot.jpg
  pages/
    about/
      index.md
assets/              # site-wide, shared assets (logo, favicon, default share image)
  logo.svg
templates/           # Liquid templates (the "theme")
config/              # content-type schemas, site config
```

Rationale for bundles: ownership is exact. Deleting an object's folder removes its images too — no orphans. Relative image links are trivial. The cost is that "create an object" means creating a folder + `index.md` rather than a single file, which the editor handles.

**Content vs. shared assets** is the organizing principle: images owned by one object colocate in its bundle; images belonging to the site/theme live in central `assets/`. Which one an upload lands in is determined by *context* — uploading from an object's edit screen writes to its bundle; uploading from site settings writes to `assets/`.

---

## 5. Content model

### Types
Users define content types via **schemas stored in the repo** (versioned, portable, self-describing). A schema declares a type's fields and their constraints, and drives three things: the editor UI, validation, and rendering.

Two kinds of type:
- **Collection types** — many instances (events, people, posts). Editor shows a list + "new," each instance is a folder.
- **Singleton types** — exactly one (e.g. global site settings). Editor shows a direct edit form; no list, no create/delete. **Global site settings is a singleton type**, edited through the same form machinery as everything else — not a special subsystem. (Homepage and "about" are *not* singletons — they're ordinary `pages`-collection objects; the homepage's root URL is a URL-routing concern, not a type distinction.)

**On-disk layout — uniform bundles.** A singleton uses the *same* folder-per-object bundle as a collection object, just without a slug subfolder since there is exactly one instance: `content/<type>/index.md` (e.g. `content/site-settings/index.md`). This keeps one loader/writer/editor model for every object; a config-only singleton simply has no colocated assets. (Collection objects live at `content/<type>/<slug>/index.md`.)

### Fields (v1 set)
Single-line text, multi-line plain text, Markdown/rich text, number, boolean, date/datetime, single-select (enum), multi-select (tags), image, reference, and video (stores a URL — see Media). The Markdown **body** is a special, always-available, optional field (some types are pure front matter with no body).

Nested/repeater fields (a list of sub-objects, e.g. an event's list of sessions) are a known **"expensive later"** feature — deferred, because the editor cost is high. v1 supports scalars, simple lists (tags), image, reference, and video.

### Identity, slugs, URLs, references, rename, delete
This cluster is one decision. The resolution:

- Each referenceable object carries an **immutable `id`** in front matter, generated once at creation, never shown as editable. It functions like a database primary key — the user essentially never sees it.
- The **slug** (folder name) is separate and freely editable; it controls the URL. Default URL pattern `/{type}/{slug}/`, overridable per type.
- **Reference fields store the `id`** but **display the object's title/slug**. Picking a "speaker" for an event searches by title, shows the title, and stores the id.
- At build time the generator builds an **id→object index** during its up-front collection-assembly pass. This index resolves references to current slugs (so links use the human-readable URL), powers the editor's reference picker, and enables **dangling-reference detection**.
- **Rename** only changes the slug/URL. References never break. Because GitHub Pages has no server-side redirects, the old URL gets an auto-generated redirect stub page (meta-refresh/JS) emitted by the generator from a stored old→new mapping.
- **Delete** is now the reference-integrity risk (not rename). Guarded by a warning that lists what references the object, using the index — resolve-first rather than silent breakage.

### Validation
Tolerant: validate declared fields (required-ness, type, enum membership, min/max, regex) but **pass through undeclared front-matter keys** rather than rejecting them (preserves the non-WordPress-rigid feel; lets power users stash ad-hoc data). Runs interactively in the editor and again at build time. The hard line is tied to page visibility: **invalid content can always be saved as a draft, but a page cannot be made public until it validates.** Validation never blocks checkpointing work; it does block broken content reaching the live site.

**Draft by default.** Visibility is a per-page `public` front-matter flag (see §11). When the flag is **absent**, the object is treated as a **draft (private)** — it is only public if it explicitly sets `public: true`. Nothing reaches the live site because a flag was forgotten; going public is always a deliberate act.

---

## 6. Templating & rendering

### Templating engine: LiquidJS
Chosen over Nunjucks. Reasons: it's **safe by construction** (parsed to an AST, no `eval`/`new Function`), which matters because templates are editable in-browser; it's TypeScript-native and runs in both browser and Node; it's actively maintained; and it natively handles the things Nunjucks struggled with — `for` loops with `limit`/`offset`, a `where` filter, `break`/`continue`, and block/layout inheritance. It's also the Jekyll/GitHub Pages lineage.

Liquid is deliberately **"logic-light":** math is done via filters (`{{ a | plus: b }}`, not `{{ a + b }}`), there are no parentheses in boolean conditions, no inline ternary, and no macros (reusable chunks are separate snippet files via `{% render %}`). This is a feature for this project: **compute in the generator (JavaScript), format in the template.** Enable the `jsTruthy` option to avoid Shopify-style truthiness surprises (blank string is otherwise truthy).

### Markdown pipeline
unified/remark/rehype: `remark-parse` → `remark-gfm` → `remark-frontmatter` → `remark-rehype` → `rehype-stringify`, plus syntax highlighting. Pure JS, runs identically in browser (preview) and Node (build).

### The generator
- **One codebase, two entry points:** imported directly by the app for live preview and pre-publish validation, and exposed as a Node CLI invoked by CI. The two must be **version-pinned together** so preview can never drift from production.
- Its job each run: walk all objects, split front matter from body, **assemble collections and derived fields**, build the id→object index, then render.
- **Derived fields** are computed at build time to keep logic out of templates. This is a deliberate *compute-in-the-generator* choice, not an engine workaround: LiquidJS *can* technically read `"now"`/`"today"` and compare dates in-template (by formatting to a `yyyyMMdd` integer), but doing so means clunky per-template date math and exposes LiquidJS's `date`-filter timezone quirks — cleaner to precompute once in JS. The field that clearly earns its place is an **`_upcoming` boolean**, because Liquid's `where` filter is equality/truthiness-only (it can't express `>= 0`), so a boolean lets `events | where: '_upcoming', true | sort: 'start' | limit: 10` filter → sort → limit in one clean chain — exactly what "next N upcoming" needs, and what an in-loop `if` can't do without breaking the limit. A `_days_from_now` integer is **optional**: handy for display ("starts in 3 days"), but not needed for sorting, since ISO-8601 date fields already sort correctly as strings. Templates can also read pre-built derived collections (e.g. `upcomingEvents`) for the common cases.
- **Site-level outputs are just more generator output** from the assembled collections: sitemaps, redirect stubs, RSS feeds, paginated listings, taxonomy/archive pages. (Search is the one exception — an external CI step.)

### Time-relative content
A **scheduled daily rebuild** (GitHub Action on a cron) refreshes time-relative derived fields so "upcoming" stays correct without runtime logic. Use **calendar-date math** (midnight-to-midnight); timezones are explicitly not a concern for this project.

---

## 7. Media

### Images
- Stored in git (acceptable), but **reprocessed at upload time, in the browser, before the file is ever committed** — because git history is permanent and because build-time image tools rely on native modules that don't run in-browser.
- Pipeline (browser-native, no dependencies): `createImageBitmap(file, { imageOrientation: 'from-image' })` (fixes EXIF rotation) → draw to canvas/`OffscreenCanvas` at capped dimensions → `toBlob(…, 'image/webp', ~0.8)`. Run in a **Web Worker** to keep the UI smooth.
- **Policy:** cap the long edge (e.g. 2048px) and re-encode; lean toward **normalizing everything** to WebP for predictable bounds and consistent output. Keep whichever is smaller of processed vs. original. Re-encoding **strips metadata** (including GPS) — a privacy win. Downscaling discards the original by design (the whole point is keeping big files out of git).
- **Edge cases:** animated GIFs pass through untouched (canvas captures one frame); SVGs pass through but are **sanitized** (SVG can carry `<script>` — XSS).
- **Settled specifics (Slice 4b):** the raster re-encode is pinned to a **2048px long-edge cap** at **WebP quality 0.8**, and animated-GIF detection walks the GIF block structure (not a naive byte count). SVG sanitization uses **DOMPurify** with the SVG profile (`USE_PROFILES: { svg: true, svgFilters: true }`) — DOM-only, zero native deps — run on the main thread (workers have no DOM) while the raster re-encode runs in the Web Worker. `image` fields require **alt text** (mandatory for accessibility; caption ≠ alt).
- **Browsing:** a media browser is a **UI index over the whole repo tree**, not a central media folder. Storage layout and browsing are separate concerns. The whole-repo-in-memory build also enables **orphan detection** (flag image files no page references).
- **Embedding in Markdown / layout:** plain Markdown can't express positioning, wrapping, or captions. The editor mediates: authors click controls (full-width / left- or right-wrap / centered / with-caption / size) and the editor **serializes the choice** to a directive or attributed-image that remark renders to a `<figure>` with CSS classes. Offer a **bounded menu of layouts**, not infinite freedom. Caption ≠ alt text (alt stays mandatory for accessibility). Responsive `srcset` can be emitted from resized variants. *(Exact directive syntax: deferred.)*

### Video
Not stored in git — **link/embed external** (YouTube/Vimeo/etc.). A `video` field stores **just a URL**; the tool validates the domain against a provider allowlist, extracts the video ID, and **constructs the iframe in the template** from that ID. Never accept raw embed HTML (XSS). Optional click-to-load "facade" (thumbnail → real iframe on click) keeps heavy third-party scripts off initial load.

---

## 8. Editor & authoring

- Content is authored through structured forms driven by the type's schema (a date field renders a date picker, a reference field renders the search-and-pick control, an image field renders the upload widget, etc.).
- **The Markdown body is edited in a markdown-native WYSIWYG: Milkdown.** This is deliberate. Milkdown is built on ProseMirror *and* remark, so its internal model **is** the Markdown AST — every editor state maps to equivalent Markdown, giving stable, byte-clean round-trips. This matters because content is git-stored Markdown and every save is a reviewed diff: a *generic* WYSIWYG that serializes a rich-text model back to Markdown reformats whole documents (indent, blank-line, and heading-marker churn) and would wreck the source diffs, git history, and custom constructs the rest of this design depends on. Milkdown also shares remark with the render pipeline, so editor and generator operate on the same AST. Specifics:
  - Only the **body** round-trips through the editor; front matter stays in the structured schema form (dates, references, enums as widgets), shrinking the round-trip surface.
  - **Image directives** and **references** are implemented as first-class Milkdown nodes (live-rendered figures; reference chips backed by the picker), not serialized text a rich-text model could mangle.
  - Keep a **raw/source toggle** as an escape hatch.
  - **Round-trip determinism is tested early** — parse real documents through the editor and assert output matches input byte-for-byte before building on top.
  - **Pinned canonical serialization.** Perfect byte-fidelity for *arbitrary* Markdown is impossible (`*`/`_`, `-`/`*` bullets, setext/atx, table padding are all equivalent), so byte-stability means a **fixed house style** that content is normalized to: authored/saved Markdown is always canonical, and every later round-trip is a no-op. The pinned style (via Milkdown's `remarkStringifyOptions`, matching Prettier's Markdown conventions) is: `-` bullets, `_emphasis_`, `**strong**`, fenced code blocks, `---` thematic breaks, one-space list-item indent. Milkdown's serializer additionally emits **compact GFM tables** and **loose** (blank-line-separated) nested/task lists — these are part of the canonical form. The guarantee is proven two ways in tests: canonical input round-trips byte-for-byte, **and** non-canonical input converges to canonical in a single pass and is stable thereafter (idempotence).
  - **UI framework: React** (with Vite). The generator/content/github packages stay framework-agnostic; only the editor app (`@timber/app`) is React. It is the first browser-only, non-isomorphic package — deliberately excluded from the generator/content isomorphism test projects.
- The **advanced/admin area** is where templates and schemas/config are edited. Architecturally it's **the same edit-preview-commit loop** pointed at `.liquid` and config files instead of content files — not a separate subsystem. Templates should be validated/rendered (via the browser generator) before a commit is allowed, to catch a broken template at author time rather than deploy time.
- A **sync-state indicator** ("all changes saved to your branch" / "unsaved local changes" / "saving…") is load-bearing for making the local-vs-branch model legible.

---

## 9. Authentication

- **GitHub is the identity and access-control layer.** No user database, no passwords. "Who can edit" = "who has write access to the content repo."
- A purely client-side app cannot complete classic GitHub OAuth alone (GitHub still requires the client secret at token exchange and the token endpoint lacks CORS). Options, from most to least infrastructure: a tiny serverless OAuth broker; the emerging GitHub App SPA/PKCE flow (worth re-checking whether it's now GA — it would allow zero backend); or a pasted fine-grained personal access token.
- Given the **self-hosted, single-tenant** decision, auth is **per-instance and lightweight** — a fine-grained PAT or simple OAuth suffices; a full GitHub App with installation custody is more than needed. **For development, paste a fine-grained PAT.**
- Auth is **deferred behind a single `getToken()` seam** — the rest of the app only needs "a valid token," so the mechanism can be chosen/swapped late without touching the rest.
- **Token security:** narrowest scopes on the single repo, prefer short-lived tokens, keep the token in memory rather than `localStorage` where feasible, ship a strict CSP. The XSS surface is already reduced (LiquidJS is sandboxed; no in-browser untrusted Node).

---

## 10. Permissions & roles

- **v1 ships without role-based permissions.** Recovery relies on git history — every save is a commit, so the whole system is a time machine; a bad change is a revert.
- Access to the advanced area is gated behind a **single seam** (e.g. `canAccessAdvanced()`, returning `true` for now) so real roles can be added later without a retrofit. Roles are worth having eventually; their shape is deferred.
- Note the limits of "just roll it back": someone has to notice and know how (favor an in-tool version history with one-click restore over expecting git knowledge); a broken template can fail the whole build, not just a page (hence author-time validation); and rollback undoes a mistake but not the reach someone had while in the advanced area (a reason to keep the seam).

---

## 11. Git workflow

### Two persistence layers, two jobs
- **IndexedDB (local, continuous autosave):** every change, instantly, device-local. Survives crashes, tab close, and reopening in the *same* browser. Does **not** cross devices and can be evicted. This is the "don't lose the last few minutes" layer.
- **Per-user WIP branch `<username>_wip` (durable, portable):** survives losing the machine, enables continuing on another device, and isolates each editor's in-progress work. This is the "my work is safe, portable, and mine" layer.

The mental model: IndexedDB is a per-device draft of not-yet-committed changes; the **WIP branch is what follows you around.** Commit reasonably eagerly so the portable copy is rarely behind, and show sync state clearly.

### Commit cadence (to the WIP branch)
Debounced and event-driven, **not** per keystroke: on navigation/blur, after ~5–15s idle, on explicit save, and best-effort on tab hide/close. **Coalesce** concurrent triggers into a single commit containing **all currently-dirty files** (one commit "edited the summer-fete event," not one per file). On failure/throttle, fall back to the local copy, show "unsaved," and retry with backoff. The exact idle interval is a tuning knob.

### Publishing
A **Publish / "Update site"** action reviews the diff, lets the user edit the commit message, and merges WIP → `main`, **squashed** so `main`'s history is clean. After each successful merge, the WIP branch is **reset/recreated from the new `main`** to minimize divergence (the single best thing for keeping conflicts rare).

### Draft vs. public (orthogonal to git sync)
Two independent axes, two words:
- **Publish / Update site** = the git action of merging WIP → main.
- **Public / Private** = a **per-page front-matter flag** honored by the generator (private pages are omitted from the live build). A page can be on `main` and still private — this is how you work on a draft over time without it being public, without stranding it on a long-lived branch. **The flag is draft-by-default: absent ⇒ private; only `public: true` publishes** (see §5 Validation).

### Conflicts
Multiple editors, but few, and single-file-per-page makes most conflicts structurally impossible (two different pages never collide). **Detect, don't resolve** (v1): track the base commit SHA the WIP branch started from; before merging, check whether `main` advanced. If not, merge cleanly. If it did, rebase onto the new `main` (applies automatically when changes don't overlap — the common case). Only when the **same file** genuinely diverged, offer keep-mine / take-theirs / reconcile. No full three-way merge editor in v1 (isomorphic-git can do it later if ever needed). A blunt "main moved, reload before publishing" is an acceptable starting point.

---

## 12. Build & deploy

- **`main` holds source only — never built HTML.** (The publish-review shows meaningful *source* diffs; committing generated HTML would bloat history and churn derived files on every edit.)
- Publish pushes source to `main` → a **GitHub Action** runs the generator (Node entry point) and **deploys the output to Pages as a build artifact** via the modern Pages deploy mechanism — **no `gh-pages` branch**, HTML never enters git.
- The **browser build** (which already exists for preview) doubles as a **pre-publish validation gate** — broken templates surface at author time. Division of labor: **the browser validates; CI deploys.** The browser never has to commit artifacts or move image bytes into an output branch; CI gets the whole repo on disk for free.
- If a build fails, the **last good deploy stays live** (Pages keeps serving it) — a useful safety property. **Deploy/build status is surfaced in the editor** ("building…/published ✓/failed").
- CI is a full Node environment, so **native tooling (`sharp`, etc.) remains available for the production build** if ever wanted (e.g. higher-quality `srcset`), even though upload-time image processing stays in the browser.
- The workflow needs Pages permissions (`pages: write`, `id-token: write`). Template it correctly once — fork-friendliness means others will copy it verbatim.

---

## 13. Site-level features

- **Navigation — manual / almost-manual.** Not auto-derived from the content tree (that would dump every event into the menu). A page carries a flag/field like "list in top-level navigation," and/or an explicit ordered nav config. Editorial, not structural.
- **Global settings** — a singleton type (title, description, base URL, social links), edited through the standard form machinery.
- **SEO — baked-in defaults** (nearly free from existing data): per-page `<title>` and meta description (from front matter, defaulting from title/excerpt), Open Graph tags with the page's hero image, canonical URLs, auto-generated `sitemap.xml` and `robots.txt`, with per-page front-matter overrides.
- **Themes** — one good **default theme** (Liquid templates + CSS) ships in the starter repo; "customizing the theme" means editing those templates/CSS in the advanced area. **No** theme browser or theme switching. (Settings-driven theme options — a few color/font fields the CSS reads — are a nice idea but **post-MVP**.)
- **Search — Pagefind.** Runs at build time from the already-rendered HTML, ships a chunked WASM index loaded lazily, no backend/API key. Slots in as a **CI step after the generator**, plus a search widget in the theme. Low effort; can be enabled early. Lives in the live site, not the editor.
- **RSS** — opt-in per collection type; easy to add but **post-MVP**.
- **Pagination / archives** — deferred until a type has enough entries to need it.

---

## 14. Technology stack

- **Templating:** LiquidJS (with `jsTruthy` enabled)
- **Markdown:** unified / remark / rehype (+ remark-gfm, remark-frontmatter, syntax highlighting)
- **Git / GitHub access (browser):** Octokit (GitHub REST API — supports CORS with a token — for reads and file commits) and/or isomorphic-git (for branch/merge/rebase semantics; can do in-browser 3-way merge later). Note: the `git clone` endpoint needs a CORS proxy, but the REST API does not.
- **Local persistence:** IndexedDB (autosave); LightningFS if using isomorphic-git.
- **Image processing:** browser-native `createImageBitmap` + canvas/`OffscreenCanvas` + Web Workers
- **Search:** Pagefind (CI step)
- **Build/deploy:** GitHub Actions → GitHub Pages (artifact deploy, no `gh-pages`)
- **Editor:** Milkdown (markdown-native WYSIWYG, built on ProseMirror + remark) for the body; structured schema forms for front-matter fields

---

## 15. MVP scope

**In scope for MVP:**
- Content repo with folder-per-object bundles; schema-defined collection and singleton types
- Field types: text (single/multi), Markdown body, number, boolean, date/datetime, enum, tags, image, reference, video
- Stable-id identity, editable slugs, reference picker, dangling-reference detection, rename-with-redirect, guarded delete
- Tolerant validation; public/private gated on validity
- LiquidJS rendering + remark/rehype pipeline; shared browser/Node generator with derived fields and id index
- In-browser image upload processing (resize/re-encode/strip/sanitize)
- Video via URL + allowlist + template-constructed embed
- Schema-driven form editor with a markdown-native WYSIWYG body editor (Milkdown); advanced (template/config) editing with author-time validation
- Auth behind `getToken()` (PAT for dev); no roles (git-history recovery); `canAccessAdvanced()` seam
- Local autosave + WIP branch + debounced coalesced commits + sync indicator
- Publish (squash-merge WIP→main, editable message, branch reset); detect-don't-resolve conflicts
- Source-only main; GitHub Action build → Pages deploy; status surfaced in editor; daily scheduled rebuild
- Manual navigation; global-settings singleton; baked-in SEO defaults; one default theme
- Versioned/pinnable distribution of the app (tagged build + thin per-site host page that pins a version); forking reserved for modification

**Deferred (post-MVP):**
- Roles/permissions (seam already in place)
- Search (Pagefind) — easy, can be pulled forward
- RSS feeds (per-type opt-in)
- Pagination / archives / taxonomy pages
- Settings-driven theme options
- Nested/repeater field types
- In-browser three-way merge UI

---

## 16. Open decisions

1. **Auth mechanism** for real (non-dev) use: serverless broker vs. GitHub App SPA/PKCE vs. simple OAuth. Deferred behind the seam; revisit when GitHub App SPA status is known.
2. **Role/permission shape** — deferred.
3. **Exact image-layout directive syntax** — deferred.
4. **Whether to pull Search forward** into MVP (low effort, user is keen).
5. **Product name.**
6. Minor tuning: idle-commit interval; per-type validation specifics; whether/when settings-driven theme options land.

---

## 17. Guiding principles

- **Own a small generator; don't wrap someone else's SSG.** Control and simplicity over ecosystem compatibility.
- **Compute in JavaScript, format in the template.** Keep templates dumb; the generator assembles collections, derived fields, and the id index.
- **Git is the source of truth; the browser is a cache.** IndexedDB for speed and crash-safety, the WIP branch for durability and portability.
- **Source in git, artifacts out of git.** Main stays readable and diff-able; CI builds and deploys.
- **Defer decisions behind seams, don't design them out.** Auth (`getToken()`) and permissions (`canAccessAdvanced()`) are the current examples.
- **Bounded choices over infinite flexibility.** A small menu of good layouts/types beats WordPress-style sprawl — it's what keeps the sites consistent and the tool simple.
- **Single-tenant and version-pinned.** Each site references a pinned build of the app, so it can change freely without breaking anyone who hasn't updated — no forced shared version, and no need to fork just to use it.
