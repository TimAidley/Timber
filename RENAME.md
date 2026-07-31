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

**But the count is misleading.** ~95% is a mechanical find/replace with zero blast radius.
The plan below is really about the ~15 identifiers that are *not* free, because they are
baked into **user data**, **users' committed repo files**, or **deployed external
infrastructure**. Those are the whole job.

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

### Tier 2 — coordinated (needs action outside the repo, but no user breakage)

- **Repo rename `TimAidley/Timber` → `TimAidley/<Name>`.** GitHub permanently redirects
  the old URL, and the site-template's `deploy.yml` clones over HTTPS, so **existing
  deployed sites keep building** through the redirect. Same for
  `TimAidley/Timber-site-template`. Still update `VITE_TIMBER_UPSTREAM_REPO`'s default in
  `vite.config.ts:46` and `TEMPLATE_REPO` in `.github/workflows/sync-template.yml` so the
  update-banner check and the template mirror point at the canonical name.
- **`TimAidley/Timber-test-sandbox`** — the live-test repo. 6 source references and ~120
  mocked API URLs in tests. Rename the repo *and* update the
  `TIMBER_SANDBOX_OWNER`/`_REPO`/`_TOKEN` secrets in `.github/workflows/live-github-tests.yml`,
  or the live suite goes red.
- **The `sync-template` push token** is scoped to the template repo by name — re-scope the
  fine-grained PAT after renaming.

### Tier 3 — breaking (needs a compat shim, a migration, or a deliberate decision)

These are the ones that cost real thought. Each touches something a user already has.

**a. IndexedDB `timber-drafts` — highest risk.**
`packages/app/src/state/localDraft.ts:17`. This holds **continuous autosave of unpublished
work**. Renaming the DB silently orphans every in-flight draft — the editor would open to
an empty store and the user's uncommitted edits would be gone with no error.
→ **Recommendation: do not rename it.** A DB name is invisible; the cost of changing it is
unbounded and the benefit is zero. If it must change, ship a one-time migration that opens
the old DB, copies records, and only then deletes — never a bare rename.

**b. `:timber-logo` shortcode — authored into users' content.**
`figureDirective.ts:21`, and used in `site-template/content/pages/{home,about}/index.md`.
Any user page containing `:timber-logo` degrades to **literal text on the page** if the
directive name changes (stray directives are neutralised back to source by design).
→ **Recommendation: rename it to the name-neutral `:logo`** and keep `timber-logo` as a
silent alias forever. This makes the shortcode immune to *this* rename and any future one.
Update the two template pages; the `roundtrip.test.ts` byte-stability fixture asserts on
the old spelling.

**c. `.timber-broker-url` — a committed file in every site repo.**
Written by `setup-broker.yml`, read by `deploy.yml`, in all four CI variants. An existing
site has the old filename committed; a *new* `deploy.yml` looking for `.<name>-broker-url`
finds nothing and **silently drops sign-in** on the next deploy.
→ Read both, old as fallback, for at least one release. Cheap: one `elif [ -f ... ]`.

**d. `window.__TIMBER_CONFIG__` — edited by self-hosting users.**
`packages/app/public/config.js`, read in `packages/app/src/host/config.ts`. Users who host
the editor themselves hand-edit this file.
→ Read `window.__<NAME>_CONFIG__` first, fall back to `window.__TIMBER_CONFIG__`, and note
the deprecation in the file's comment block.

**e. `TIMBER_*` / `VITE_TIMBER_*` — ~20 distinct names, set as GitHub repo Variables.**
`TIMBER_REPO`, `TIMBER_REF`, `TIMBER_DEPLOY_TARGET`, `TIMBER_EDITOR_PATH`,
`TIMBER_EDITOR_ORIGIN`, `TIMBER_OAUTH_*`, `TIMBER_BASE`, and the `VITE_TIMBER_*` build vars.
Users set these **in their repo settings**, not in a file we control. Existing sites are
safe while their old `deploy.yml` sits unchanged, but the moment they pull a template
update their variables stop being read — a config that silently reverts to defaults.
→ In the workflow, read `${{ vars.<NAME>_X || vars.TIMBER_X }}` for one release, and put
the rename in INSTALL.md's upgrade notes. `VITE_TIMBER_*` is compiled in by our own CI, so
those can be renamed freely alongside `vite.config.ts` and `buildInfo.ts`.

**f. Cloudflare worker `timber-oauth-broker`.**
`packages/oauth-broker/wrangler.toml:16`. The worker **name determines its URL**
(`https://timber-oauth-broker.<subdomain>.workers.dev`), which is what got committed into
every existing site's `.timber-broker-url`. Renaming deploys a *new* worker at a *new* URL
and leaves every existing site pointing at the old one.
→ **Recommendation: do not rename the worker**, or rename it and leave the old one
deployed indefinitely. The name is near-invisible (it appears once in a URL nobody types)
and the breakage is a hard sign-in failure.

**g. Token storage keys** — `timber.host.pat` (localStorage), `timber.oauth.{token,state,verifier}`
and `timber.device.token` (sessionStorage), plus `timber:layout:*`.
Renaming logs everyone out and, for the PAT path, forces a re-paste of a token the user
may not still have.
→ Low stakes but zero benefit. Leave them, or migrate-then-delete on first read.

**The pattern across Tier 3:** every one of these is an *identifier the user never sees*.
The general rule I'd apply — rename what is **visible** (docs, wordmark, page title, repo,
package scope) and leave what is merely **internal but persisted** (DB names, storage keys,
the worker name) unless there's a reason beyond tidiness.

---

## 5. Suggested sequencing

Small reviewable commits, riskiest-first, per the repo's own working style:

1. **Decide the name.** Everything below is blocked on it.
2. **Neutralise the shortcode** (`:timber-logo` → `:logo` + alias). Independent of the
   name choice, lands first, removes item (b) from the critical path entirely.
3. **Add the font subsetting script** and regenerate for the new name; update both
   `@font-face` copies, both wordmark emitters, and the tests. Eyeball the result at
   banner and sign-in sizes before going further. *This is the only step with genuine
   design risk — do it early enough to change the name if the wordmark doesn't work.*
4. **Compat shims** for `.timber-broker-url`, `window.__TIMBER_CONFIG__`, and the
   `vars.TIMBER_*` reads — merged **before** the sweep, so no window exists where a
   template update breaks a live site.
5. **The mechanical sweep**: `@timber/*` scope, prose, comments, plugin names, page title.
   One large but boring diff; keep it separate from everything above so review is
   `git diff --stat` plus spot-checks.
6. **Rename the GitHub repos**, update `TEMPLATE_REPO`, the provenance defaults, the
   sandbox secrets, and re-scope the sync PAT.
7. **Explicitly do not rename**: the IndexedDB store, the storage keys, the Cloudflare
   worker. Record the decision in SPEC.md so it doesn't get "tidied up" later.
8. **Update SPEC.md / ARCHITECTURE.md / INSTALL.md** in the same PRs that change behaviour
   (SPEC is authoritative — it can't lag), and add an INSTALL.md upgrade note for existing
   site owners covering the repo-variable rename.

## 6. Open questions

- Which name? (Recommendation: **Timprint**. Flagging that **Timpress** trades one
  WordPress-adjacent confusion for a stronger one, and that **VerbaTim** costs a wordmark
  redesign plus an npm collision.)
- Do we want a domain / GitHub org for the new name before committing to it?
- Is there any published site in the wild besides the sandbox? If not, most of Tier 3
  collapses to Tier 1 and this gets much cheaper — worth confirming before building shims.
