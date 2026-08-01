# Running Timber locally / developing

For running the editor on your own machine, building a site by hand, or hacking on Timber
itself. To stand up a **hosted** site with no local tooling, see the
**[setup guide](https://timaidley.github.io/Timber/install.html)** instead.

**Prerequisites:** Node ≥ 20, pnpm 10 (`npm i -g pnpm@10`), git, and a clone of this repo.

```sh
git clone https://github.com/TimAidley/Timber.git && cd Timber
pnpm install
```

## Run the editor locally

The editor reads its config from a runtime `config.js` (highest priority), then `VITE_*`
build env, then defaults. Either works locally.

**Option 1 — `config.js` (no rebuild):** `packages/app/public/config.js` ships empty;
uncomment the `window.__TIMBER_CONFIG__` block and fill it in. Vite serves it at
`/config.js`.

**Option 2 — build env:** `cp packages/app/.env.example packages/app/.env` and set:
```ini
VITE_TIMBER_OWNER=<owner>
VITE_TIMBER_REPO=<content-repo>
# Optional — for "Sign in with GitHub" locally (else you get the paste-a-PAT gate):
# VITE_TIMBER_OAUTH_CLIENT_ID=<client-id>
# VITE_TIMBER_OAUTH_BROKER_URL=https://timber-oauth-broker.<you>.workers.dev
# VITE_TIMBER_OAUTH_FLOW=device        # or unset for the redirect flow
```

Then start Vite:
```sh
pnpm --filter @timber/app dev          # serves at http://localhost:5173/
```

Whatever sign-in you configure must match `http://localhost:5173/` exactly: register that
as the GitHub App / OAuth App **callback URL**, and put it in the broker's
`ALLOWED_ORIGINS`. Restart `dev` after `.env` changes.

### Quickest local start: paste a PAT

Leave all `VITE_TIMBER_OAUTH_*` unset (and no `config.js` OAuth block), run
`pnpm --filter @timber/app dev`, and paste a **fine-grained PAT** (GitHub → Settings →
Developer settings → Fine-grained tokens) scoped to your repo with **Contents: Read &
write** (add **Actions: Read & write** for deploy status/retry). No Cloudflare, no App.
The token is kept in `localStorage`.

## When a save fails

The header names the cause (**"Save failed — signed out (401)"**) and its **Details**
button opens the diagnostics panel: the recent failures with status, request id and the
host's own message, plus **Copy** for a bug report. The same log is reachable from the
console — `__timber.dump()` — which is the quickest way to see *why* a commit is being
retried without reproducing it with DevTools already open.

Two things it will tell you that are easy to misread otherwise: a **401** means the
session expired (retrying can never fix it — sign in again), and a **404** on save
usually means the token lacks **Contents: write**, not that the repo is missing. The log
is per-tab, capped in size, never persisted, and token-shaped strings are redacted before
they reach it — so it's safe to paste.

## Build a site by hand

```sh
pnpm --filter "@timber/cli..." build
node packages/cli/dist/index.js build <path-to-content-repo> _site   # renders into ./_site
```

## Deploy the broker by hand

The broker is normally deployed by a workflow, but you can do it directly with Wrangler:

```sh
cd packages/oauth-broker
npx wrangler login
# Redirect flow needs the secret; device flow does not — skip this line for device-only.
npx wrangler secret put OAUTH_CLIENT_SECRET          # the App's client secret
npx wrangler deploy \
  --var OAUTH_CLIENT_ID:<client-id> \
  --var ALLOWED_ORIGINS:<editor-origin>              # e.g. http://localhost:5173 — scheme+host, no path
```

`ALLOWED_ORIGINS` is a comma-separated list, so one broker can serve several origins. The
env var names are `OAUTH_*`, not `GITHUB_*`, because GitHub Actions reserves the `GITHUB_`
prefix (the broker still reads legacy `GITHUB_CLIENT_ID/SECRET` as a fallback). See
`packages/oauth-broker/README.md` and `docs/auth-github-app.md`.

## Seed a content repo from the scaffold

`site-template/` is a real, buildable example site (theme, schemas, sample content, and the
deploy workflows). To start a new content repo from it by hand:

```sh
cp -r /path/to/Timber/site-template <content-repo> && cd <content-repo>
git init -b main && git add -A && git commit -m "Seed site from Timber site-template"
git remote add origin https://github.com/<owner>/<content-repo>.git
git push -u origin main
```

(`site-template/` is also the source that's mirrored to the `Timber-site-template` repo —
edit it here, never there. See `ARCHITECTURE.md`.)

## Repo layout & how the pieces fit

See **`ARCHITECTURE.md`** for the package map and dependency graph, and **`SPEC.md`** for
the authoritative design. Tests: `pnpm -r --filter './packages/*' exec vitest run`.
