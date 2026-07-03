# CLAUDE.md

## What this is
A git-backed static CMS — a lightweight, friendly-to-edit alternative to WordPress that produces a **static site** deployed to GitHub Pages. Site owners define their own **content types** (events, people, pages…), edit content in-browser, and publish by committing to a GitHub repo. Self-hosted, single-tenant (one instance per site). No database, no server-side app.

## Read first — the spec is authoritative
**`SPEC.md` in this repo is the authoritative design. Read it in full before planning or writing any code.** If anything in this file and `SPEC.md` ever conflict, `SPEC.md` wins. **When we change a decision, update `SPEC.md` in the same change** so it stays the single source of truth.

## How to work in this repo
- **Plan before building.** For any non-trivial piece, propose an approach and let me review it before writing code. Use plan mode for multi-step work.
- **Build in phases, riskiest core first** (see build order). Do not scaffold the whole app at once.
- **Small, reviewed commits** with clear messages; keep diffs easy to review. (The product itself is git-backed precisely so mistakes are a revert — work the same way.)
- **Ask, don't invent.** If a requirement is ambiguous or absent from `SPEC.md`, ask rather than guessing or inventing scope.

## Settled decisions — build to these, don't re-litigate
(All are established in `SPEC.md`.)
- **Templating: LiquidJS** (enable `jsTruthy`). Not Nunjucks. Principle: compute in the generator, format in templates — keep templates dumb.
- **Markdown pipeline: unified / remark / rehype.**
- **Body editor: Milkdown** (markdown-native WYSIWYG on ProseMirror + remark). Round-trip must be **byte-stable — test it early**. Never use a rich-text editor that serializes to Markdown from a foreign model.
- **Content storage: folder-per-object bundles.** Each object = a folder with `index.md` (front matter = structured data; body = Markdown) plus colocated assets. Site-wide assets live in `/assets`.
- **Identity:** stable front-matter `id` on referenceable objects; **slugs are editable and drive URLs**. Reference fields store the `id`, display the title. The generator builds an **id→object index** up front (resolves links, powers the reference picker, detects dangling references). Rename changes only the slug/URL (+ redirect stub); guard deletes of referenced objects.
- **Generator = one codebase, two entry points** (browser for preview/validation, Node CLI for CI), **version-pinned together** so preview ≡ production.
- **`main` holds source only.** Built HTML never enters git. A GitHub Action runs the Node generator and deploys to Pages as an artifact (no `gh-pages` branch).
- **Images processed in-browser at upload** (canvas → WebP; resize, strip metadata, sanitize SVG, pass through animated GIF) *before* commit. **Video = external URL** + provider allowlist + template-constructed embed; never accept raw embed HTML.
- **Two seams — don't hardwire their absence:** `getToken()` for auth (paste a fine-grained PAT for dev) and `canAccessAdvanced()` for the advanced/admin area (returns `true` for now; real roles later).
- **Distribution:** the app is a versioned, pinnable static build; a site is a thin host page pinning a version + its config — not a per-site fork.

## Build order (phased)
1. **Scaffold + shared generator core.** remark→Liquid as one module with browser + Node entry points; render a page from front matter + body. Prove preview output ≡ build output.
2. **GitHub read/commit loop.** Load a repo's content into memory, edit a file, commit back (behind `getToken()`; PAT for dev). Prove load → edit → commit.
3. **Content model.** Schemas; collection vs singleton types; field types; id index; reference resolution; tolerant validation (invalid content can be saved as draft but not made public).
4. **Editor.** Schema-driven forms + Milkdown body editor (with round-trip tests); in-browser image upload pipeline.
5. **Git workflow.** IndexedDB continuous autosave; per-user `<username>_wip` branch; debounced, coalesced commits; Publish = squash-merge WIP→main with editable message + branch reset; per-page draft/public front-matter flag; conflict *detection* (base-SHA check → clean rebase → keep-mine/take-theirs), no full merge UI in v1.
6. **Build & deploy.** GitHub Action runs the Node generator → deploys to Pages; deploy status surfaced in the editor; browser build doubles as pre-publish validation gate.
7. **Site features.** Manual navigation; global-settings singleton; baked-in SEO defaults (title/description/OG/sitemap/robots); one default theme. *(Deferred: RSS, Pagefind search, pagination, roles.)*

## Conventions
- **TypeScript throughout.** (Frontend framework: decide during planning; keep the generator framework-agnostic.)
- **Prefer the browser-native, zero-native-dependency path** — that constraint is *why* this architecture exists (see `SPEC.md` §2). Native modules (e.g. `sharp`) are acceptable **only** in the CI build, never in the browser bundle.
- **Never** put tokens in URL params; avoid `localStorage` for tokens where feasible; keep anything secret out of committed files.
