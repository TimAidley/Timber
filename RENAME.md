# Renaming Timber — impact analysis and plan

**Status:** proposal, not yet executed. Written to scope the cost of moving off the name
"Timber" (collision: [Timber, the WordPress theming library](https://github.com/timber/timber),
~5k stars, same "CMS-adjacent" space — a genuine confusion risk).

Candidates under consideration: **Timpress**, **Timpact**, **VerbaTim**, **Timprint**.

---

## 1. Scope at a glance

`timber` (any case) appears **1,230 times across 225 files**:

| Where | Occurrences | Nature |
|---|---|---|
| `.ts` / `.tsx` | 459 | 199 `@timber/*` imports, 57 `TIMBER_*` env reads, 113 prose comments, 6 test-fixture repo URLs, rest = identifiers |
| `.json` | 270 | package names + `@timber/*` dependency edges + lockfile |
| `.md` | 236 | SPEC 70, ARCHITECTURE 60, docs/ 49, INSTALL 20, DEVELOPMENT 18, README 2 |
| `.yml` / `.yaml` | 217 | CI workflows (ours + the four site-template variants) |
| `.css` / `.html` | 13 | `@font-face` family, `.wordmark` rules, page title |

**But the count is misleading**, in both directions. ~95% is a mechanical find/replace with
zero blast radius. A further ~15 identifiers are persisted — in browser storage, in users'
committed repo files, in deployed infrastructure — and would normally each need a compat
shim; **with no installs to protect (see Tier 3), they collapse into the same sweep.**

That leaves exactly one piece of real work: **the wordmark**, which is neither mechanical
nor reversible-by-grep.

---

## 2. Choosing the name

Three of the four candidates preserve the thing the brand is actually built on: **the
wordmark emphasises "Tim" as a leading prefix** (`<span class="wordmark__tim">Tim</span>ber`)
— the author's own name, in ink, with the remainder muted. That structure is hardcoded in
two places and assumed by the CSS.

| | Glyphs to add to the font subset | Wordmark structure | Name-collision check | Notes |
|---|---|---|---|---|
| **Timpress** | `p`, `s` (2) | unchanged — `Tim` + `press` | clear in software ([TIMPRESS SA](https://www.dnb.com/business-directory/company-profiles.timpress_sa.c18e893b6ef944676355df10fce76636.html) is a Romanian printing firm; a dormant [GitHub topic](https://github.com/topics/timpress)) | ⚠️ **leans into WordPress.** We're renaming to *escape* a WordPress-ecosystem collision; "-press" reads as "a WordPress thing". Arguably a worse confusion than the one being fixed. |
| **Timpact** | `p`, `a`, `c`, `t` (4) | unchanged — `Tim` + `pact` | clear | Says nothing about what it does; reads as generic SaaS. Bonus reading: "pact" ≈ the git commit contract. |
| **VerbaTim** | `V`, `a` (2) | ❌ **inverted** — see below | ✗ `verbatim` is [taken on npm](https://registry.npmjs.org/verbatim), and is a common English word — near-zero search discoverability | Best pun, highest cost. |
| **Timprint** | `p`, `n`, `t` (3) | unchanged — `Tim` + `print` | clear ([@timprint](https://gist.github.com/timprint) is a personal GitHub handle, no project) | "print" = publishing/static output. Says what it does without borrowing a competitor's noun. |

**Recommendation: Timprint**, with Timpact as the fallback.

**VerbaTim is the expensive one** and it isn't only a font issue:

- The emphasised "Tim" moves from **prefix to suffix**, so `Wordmark.tsx` and
  `transformWordmark()` both have to emit `text → span` instead of `span → text`.
- The two-tone rhythm inverts (currently ink-then-muted; would become muted-then-ink),
  and the mid-word capital `a|T` seam needs `letter-spacing` / `SOFT` / `WONK` re-tuned
  by eye. That's design work, not a mechanical edit.
- Lowercased for the package scope it becomes `@verbatim/*`, which loses the pun entirely
  — and collides with an existing npm package name if we ever publish.

---

## 3. The wordmark — the one piece that isn't find/replace

Current state:

- `packages/app/src/fonts/fraunces-timber.woff2` (7,572 B) — Fraunces, **subset to exactly
  the glyphs `T b e i m r`**, retaining all four axes (`opsz 9–144`, `wght 100–900`,
  `SOFT 0–100`, `WONK 0–1`). Verified with fontTools.
- `packages/generator/src/wordmarkFont.ts` — that woff2 base64'd (~10 KB), so the
  `:timber-logo` shortcode is **self-contained on every published site**.
- `scripts/gen-wordmark-font.mjs` — regenerates the base64 wrapper.
- `packages/app/src/styles.css` + `packages/generator/src/wordmarkStyle.ts` — two copies
  of the `@font-face` (family `'Fraunces Timber'`) and the `.wordmark` / `.wordmark__tim`
  rules, one for the editor, one injected post-sanitize into built pages.

**Gap to fill first:** the repo contains only the *already-subsetted* woff2. There is no
full Fraunces source and **no subsetting script** — that step was done by hand, outside
the repo. Any rename needs it redone, so the rename PR should also add
`scripts/subset-wordmark-font.sh` (fetch Fraunces variable TTF → `pyftsubset --text=<NAME>`
with `--variations` preserving all four axes → woff2), making the subset reproducible
instead of a one-off artifact. Keep `LICENSE-Fraunces.txt` (OFL-1.1) alongside it.

Work items, in order:

1. Add the subsetting script; regenerate the woff2 for the new glyph set.
2. Re-run `gen-wordmark-font.mjs` → new `wordmarkFont.ts`.
3. Rename the file `fraunces-timber.woff2` → `fraunces-<name>.woff2` and the CSS family
   `'Fraunces Timber'` → `'Fraunces <Name>'` **in both copies** (`styles.css`,
   `wordmarkStyle.ts` — they must stay in sync or preview ≢ build).
4. Update the split literal in **both** emitters: `Wordmark.tsx` and
   `figureDirective.ts:transformWordmark()`.
5. Re-check optical tuning: `font-weight: 440`, `letter-spacing: -0.005em`,
   `SOFT 12`/`WONK 1`. These were tuned for "Timber"'s specific letterforms; descender-free
   `Timprint`/`Timpact` and the `p` descender in all three will read differently at banner
   size vs sign-in size.
6. `packages/generator/test/wordmark.test.ts` and the `roundtrip.test.ts` byte-stability
   fixture both assert on the old literals.

**Published sites keep the old wordmark until they redeploy.** That's fine and expected
(the font is embedded per-document), but it means the transition is visible in the wild
for as long as sites go un-rebuilt.

---

## 4. Change classes, by risk

### Tier 1 — free (mechanical find/replace, no external coordination)

Do these in one sweep; nothing outside the repo observes them.

- **npm scope `@timber/*` → `@<name>/*`** (199 import sites + 12 `package.json` names +
  their dependency edges + `pnpm-lock.yaml` + `pnpm --filter "@timber/app..."` in four CI
  files). Safe because **nothing is published** — `version: 0.0.0`, workspace-internal
  only, distribution is a static build not a registry artifact. Note: `timpress`,
  `timpact` and `timprint` are all free on npm; `verbatim` is not.
- **Prose** in SPEC.md, ARCHITECTURE.md, INSTALL.md, DEVELOPMENT.md, README.md, `docs/*.md`,
  and 113 source comments. Per CLAUDE.md, **SPEC.md must land in the same change**.
  README's `**Tim**ber` markdown-bold wordmark needs its split moved too.
- **Vite plugin names** `timber-config-script`, `timber-build-provenance`
  (`packages/app/vite.config.ts`) — build-internal strings.
- **Preview-only attribute** `data-timber-theme` (`renderSitePage.ts`) — never reaches a
  published site; only two tests assert on it.
- **Editor page title** `Timber — editor` (`packages/app/index.html`).
- **Log prefix** `[timber]` in `autosave.ts`.
- **`TIMBER_BASE`** — read only by our own `vite.config.ts` at build time.

Not affected, worth confirming: the `<username>_wip` branch convention, the content
bundle layout, front-matter keys, and the `id`/slug model carry **no** product name.
`CLAUDE.md` never names the product at all.

### Tier 2 — coordinated (needs action outside the repo)

- **Repo rename `TimAidley/Timber` → `TimAidley/<Name>`.** GitHub permanently redirects the
  old URL, and the site-template's `deploy.yml` clones over HTTPS, so anything still
  pointing at the old name keeps working. Update `VITE_TIMBER_UPSTREAM_REPO`'s default in
  `vite.config.ts:46` and `TEMPLATE_REPO` in `.github/workflows/sync-template.yml` so the
  update-banner check and the template mirror point at the canonical name.
- **`TimAidley/Timber-test-sandbox`** — the live-test repo. 6 source references and ~120
  mocked API URLs in tests. Rename the repo *and* update the
  `TIMBER_SANDBOX_OWNER`/`_REPO`/`_TOKEN` secrets in `.github/workflows/live-github-tests.yml`,
  or the live suite goes red.
- **The `sync-template` push token** is scoped to the template repo by name — re-scope the
  fine-grained PAT after renaming.

### Tier 3 — persisted identifiers (no longer a migration; rename them all)

> **Resolved.** Only two tiny test sites exist, and they will be deleted and recreated
> rather than migrated. That removes the entire compat burden: **no fallback reads, no
> dual-key lookups, no deprecation window, no upgrade notes.** Everything below drops to a
> plain find/replace and can ride along in the Tier 1 sweep.

Recording what these *were* going to cost, so the reasoning survives if the project ever
does acquire installs it can't just recreate:

| Identifier | Location | Would have broken | Now |
|---|---|---|---|
| IndexedDB `timber-drafts` | `state/localDraft.ts:17` | silently orphans every unpublished autosaved draft | rename freely — worst case is losing your own local dev drafts, so **clear site data after the switch** rather than debugging an empty store |
| `:timber-logo` shortcode | `figureDirective.ts:21` + 2 template pages | authored pages render the literal text `:timber-logo` | rename — **see below, still worth doing differently** |
| `.timber-broker-url` | 4 CI variants | new `deploy.yml` can't find it → sign-in silently drops | plain rename |
| `window.__TIMBER_CONFIG__` | `public/config.js`, `host/config.ts` | self-hosted editor configs stop being read | plain rename |
| `TIMBER_*` repo Variables (~20) | 4 CI variants | user-set config silently reverts to defaults | plain rename |
| `VITE_TIMBER_*` build vars | `vite.config.ts`, `buildInfo.ts` | — (always compiled in by our CI) | plain rename |
| Cloudflare worker `timber-oauth-broker` | `wrangler.toml:16` | worker name *is* its URL → hard sign-in failure for existing sites | rename, then **delete the old worker** so it doesn't linger and confuse |
| Token/layout storage keys | `hostDescriptor.ts:78`, `oauth.ts:22-24`, `deviceFlow.ts:18`, `layout.ts:21-23` | logs everyone out; PAT users must re-paste | plain rename — expect to re-paste your own dev PAT once |

**One item is still worth handling on its own merits, not for compat:**

`:timber-logo` is the only name-bearing identifier that gets **typed into content by
authors**. Renaming it to `:timprint-logo` means a *future* rename breaks content all over
again. Rename it to the name-neutral **`:logo`** instead and the shortcode never has to
change again. This is now cheaper than it was — no alias to keep, since there's no content
in the wild to preserve. Update the two template pages and the `roundtrip.test.ts`
byte-stability fixture.

---

## 5. Suggested sequencing

Small reviewable commits, riskiest-first, per the repo's own working style:

With no installs to protect, this is now four commits, not eight.

1. **Decide the name.** Everything below is blocked on it.
2. **Neutralise the shortcode** (`:timber-logo` → `:logo`). Independent of the name
   choice, so it can land first and never needs revisiting.
3. **The wordmark.** Add the font subsetting script, regenerate for the new glyph set,
   update both `@font-face` copies, both emitters, and the tests. Eyeball the result at
   banner *and* sign-in sizes. **This is the only step with genuine design risk — do it
   before the sweep, while changing your mind about the name is still cheap.**
4. **The mechanical sweep.** Everything else in one boring diff: `@timber/*` scope, all
   Tier 3 identifiers, prose, comments, plugin names, page title. Review is
   `git diff --stat` plus spot-checks. Update SPEC.md and ARCHITECTURE.md **in this
   commit** — SPEC is authoritative and can't lag.
5. **Rename the GitHub repos**, update `TEMPLATE_REPO`, the provenance defaults, the
   sandbox secrets, and re-scope the sync PAT. Then recreate the two test sites from the
   renamed template — which doubles as the end-to-end verification that the sweep is
   complete.
6. **Redeploy the broker** under its new name and delete the old worker.

Afterwards, the check that matters: `grep -ri timber .` should return **only**
`RENAME.md`, this repo's own git history, and the `LICENSE-Fraunces.txt` filename if the
subset artifact keeps its old name by accident.

## 6. Open questions

- Which name? (Recommendation: **Timprint**. Flagging that **Timpress** trades one
  WordPress-adjacent confusion for a stronger one, and that **VerbaTim** costs a wordmark
  redesign plus an npm collision.)
- Do we want a domain / GitHub org for the new name before committing to it?
- ~~Is there any published site in the wild?~~ **Answered: no — two test sites, to be
  deleted and recreated.** Tier 3 collapses into the sweep; no shims needed.
