# Installing Timber — stand up a live site + the OAuth editor

This walks you through the **full production setup**: a new content repo that
publishes to GitHub Pages, the Cloudflare Worker that lets you sign in with GitHub,
and the editor app pointed at both. Follow it top to bottom.

There are **three moving parts**:

1. **Content repo** — your site's source (seeded from `starter/`). A GitHub Action
   builds it and deploys to **GitHub Pages** → this is your public website.
2. **OAuth broker** — a tiny **Cloudflare Worker** that holds your GitHub client
   secret. It's the one server-side piece; a static SPA can't finish GitHub OAuth
   alone (the token exchange needs the secret and GitHub's endpoint has no CORS).
3. **Editor app** (`@timber/app`) — the Timber SPA you edit in. Signs you in via the
   broker and commits to the content repo.

```
You ──edit──▶ Editor app ──sign in──▶ broker (Cloudflare) ──▶ GitHub
                  │                                              │
                  └──commit to content repo──▶ GitHub Action ──▶ Pages (your site)
```

> **Shortcut:** If you just want to *see the editor working* before doing all of
> this, skip straight to the [PAT quick-start](#appendix-a--skip-oauth-paste-a-pat)
> — it runs the editor locally with no OAuth App and no Cloudflare. Come back here
> for the real thing.

---

## Prerequisites

- **Node ≥ 20** and **pnpm 10** (`npm i -g pnpm@10`). This repo pins `pnpm@10.33.0`.
- **git**, a **GitHub account** (these steps assume the owner is `TimAidley` — change
  to yours throughout), and a **Cloudflare account** (free tier is fine).
- A local clone of **this Timber repo** (you already have it).
- The Timber repo (`TimAidley/Timber`) must be **public**, or the deploy Action can't
  check it out. It's public by default; if you made it private, see
  [Troubleshooting](#troubleshooting).

Throughout, replace these placeholders:

| Placeholder | Meaning | Example |
|---|---|---|
| `<owner>` | your GitHub username | `TimAidley` |
| `<site-repo>` | the new content repo's name | `timber-site` |
| `<editor-origin>` | where the editor runs (scheme+host, **no path/slash**) | `http://localhost:5173` |

Your published site will live at `https://<owner>.github.io/<site-repo>/`.

---

## Step 1 — Create the content repo from `starter/`

The `starter/` folder in this repo is a complete, buildable example site (home +
about pages, a theme, schemas, settings, and the deploy workflow). Copy it into a
fresh repo.

1. **Create an empty repo** on GitHub named `<site-repo>` — **Public** (required for
   free Pages), with **no** README/licence/gitignore (keep it empty).

2. **Seed it from `starter/`.** From anywhere on your machine:

   ```sh
   # copy the starter into a new working dir (adjust the path to your Timber clone)
   cp -r /path/to/Timber/starter <site-repo>
   cd <site-repo>

   git init -b main
   git add -A
   git commit -m "Seed site from Timber starter"
   git remote add origin https://github.com/<owner>/<site-repo>.git
   git push -u origin main
   ```

   The workflow file (`.github/workflows/deploy.yml`) is included in `starter/`, so it
   lands in your repo automatically.

3. **Set your site's base URL.** Edit `content/settings/index.md` and change
   `baseUrl` to your Pages URL (used for canonical links, sitemap, and OG tags):

   ```yaml
   baseUrl: https://<owner>.github.io/<site-repo>
   ```

   Commit and push. (You can also do this later from the editor.)

> **Pin Timber (optional but recommended).** `.github/workflows/deploy.yml` has
> `TIMBER_REF: main`. `main` works, but pinning to a Timber **release tag** keeps
> "preview ≡ production" stable over time. Change `TIMBER_REF` to a tag once you cut
> one.

---

## Step 2 — Enable GitHub Pages

In the **content repo** on GitHub: **Settings → Pages → Build and deployment →
Source: “GitHub Actions.”**

That's the only Pages setting you need — the workflow uploads the built site as an
artifact and deploys it directly (no `gh-pages` branch).

---

## Step 3 — First deploy

The push from Step 1 already triggered the **Build & deploy site** Action (it runs on
every push to `main`, plus manual runs and a daily rebuild).

- Watch it under the repo's **Actions** tab. First run takes a couple of minutes
  (it installs Timber and builds the CLI).
- When green, your site is live at **`https://<owner>.github.io/<site-repo>/`**.

If the run fails, see [Troubleshooting](#troubleshooting). You now have a working
site — the rest wires up the in-browser editor.

---

## Step 4 — Register a GitHub OAuth App

This gives the editor a way to sign you in. **GitHub → Settings → Developer settings
→ OAuth Apps → New OAuth App.**

- **Application name:** anything (e.g. "Timber editor").
- **Homepage URL:** your editor's URL. For local dev that's `http://localhost:5173/`.
- **Authorization callback URL:** the **same** URL, exactly — `http://localhost:5173/`.
  The SPA handles the `?code` on its own page, so the callback *is* the app's own URL.
  ⚠️ This must match the editor's origin+path exactly (trailing slash included), or
  sign-in fails with a redirect_uri mismatch.
- Click **Register application**.
- Copy the **Client ID** (public — safe to expose).
- Click **Generate a new client secret** and copy it now (**private** — you'll paste
  it into Cloudflare in the next step and never anywhere else).

> Running the editor somewhere other than localhost later? Register that URL as the
> callback (or add a second OAuth App for it), and update `ALLOWED_ORIGIN` +
> the app env accordingly.

---

## Step 5 — Deploy the broker to Cloudflare

The broker lives in `packages/oauth-broker/`. It trades the OAuth `code` for a token,
holding your client secret server-side. From your **Timber** clone:

```sh
cd packages/oauth-broker

# one-time: authenticate wrangler with your Cloudflare account
npx wrangler login

# store the client secret in Cloudflare's secret store (never committed/logged)
npx wrangler secret put GITHUB_CLIENT_SECRET
# └─ paste the client secret from Step 4 when prompted

# deploy, passing the two non-secret values
npx wrangler deploy \
  --var GITHUB_CLIENT_ID:<your-client-id> \
  --var ALLOWED_ORIGIN:<editor-origin>
```

- `<editor-origin>` is the **exact** origin of your editor — scheme + host, **no path,
  no trailing slash**. For local dev: `http://localhost:5173`. The broker rejects
  every other origin, so this must be right.
- `wrangler deploy` prints the worker URL, e.g.
  `https://timber-oauth-broker.<you>.workers.dev`. **Copy it** — that's your
  `VITE_TIMBER_OAUTH_BROKER_URL` in the next step.

> Prefer config files over flags? Uncomment and set `GITHUB_CLIENT_ID` and
> `ALLOWED_ORIGIN` under `[vars]` in `packages/oauth-broker/wrangler.toml`, then just
> `npx wrangler deploy`. (Never put the *secret* in `wrangler.toml` — always use
> `wrangler secret put`.)

**Sanity check** the broker rejects strangers (should print `origin_not_allowed`):

```sh
curl -s -X POST https://timber-oauth-broker.<you>.workers.dev \
  -H 'Origin: https://evil.example' -H 'Content-Type: application/json' \
  -d '{"code":"x"}'
```

---

## Step 6 — Configure and run the editor

Back in your **Timber** clone:

```sh
# install workspace deps (first time only)
pnpm install

# point the editor at your repo + broker
cp packages/app/.env.example packages/app/.env
```

Edit `packages/app/.env`:

```ini
VITE_TIMBER_OWNER=<owner>
VITE_TIMBER_REPO=<site-repo>

# both set ⇒ "Sign in with GitHub"; unset ⇒ paste-a-PAT dev gate
VITE_TIMBER_OAUTH_CLIENT_ID=<your-client-id>
VITE_TIMBER_OAUTH_BROKER_URL=https://timber-oauth-broker.<you>.workers.dev
```

Run it:

```sh
pnpm --filter @timber/app dev
```

Vite prints the URL (default **http://localhost:5173/**). **It must match** the
OAuth callback (Step 4) and `ALLOWED_ORIGIN` (Step 5) exactly. If Vite picks a
different port (e.g. 5173 was taken), update both the OAuth App callback and redeploy
the broker with the new `ALLOWED_ORIGIN`.

> `.env` changes only take effect on a **dev-server restart**.

---

## Step 7 — Sign in and build your site

1. Open the editor URL → click **Sign in with GitHub** → authorise (scope: `repo`,
   so it can commit to your content repo). You'll bounce to GitHub and back; the
   `?code` is exchanged via the broker and stripped from the URL.
2. The editor loads your repo. Try the full loop:
   - **＋ New** → pick a type (e.g. `pages`) + a title → edit fields + body.
   - Use the **reference picker**, **rename**, and **delete** as needed.
   - Edits autosave to a `‹your-login›_wip` branch (watch the sync indicator).
   - **Publish…** → review the diff → confirm → it squash-merges to `main`.
3. The push to `main` triggers the deploy Action; the editor's **deploy status**
   chip tracks *building… / published ✓*. Your live site updates at
   `https://<owner>.github.io/<site-repo>/`.

That's the whole loop: edit in the browser → publish → auto-deploy.

---

## Troubleshooting

- **Deploy Action fails at "Check out Timber."** `TimAidley/Timber` must be public
  (the Action checks it out anonymously). If it's private, either make it public, or
  add a PAT with `repo` read as an Actions secret and set `token:` on that checkout
  step.
- **Sign-in returns to a blank page / `redirect_uri` mismatch.** The OAuth App
  callback URL must equal the editor's origin+path **exactly** (trailing slash
  included). Local dev = `http://localhost:5173/`.
- **`origin_not_allowed` when signing in.** The broker's `ALLOWED_ORIGIN` doesn't
  match the editor origin. Redeploy with the exact scheme+host (no path/slash) and
  confirm the port matches what Vite actually used.
- **Sign-in works but the repo won't load.** Check `VITE_TIMBER_OWNER` /
  `VITE_TIMBER_REPO` and that your GitHub account has write access to that repo.
  Restart `pnpm dev` after `.env` edits.
- **Pages 404 after a green deploy.** Confirm **Settings → Pages → Source = GitHub
  Actions**, and give the first deploy a minute to propagate.
- **Broken/invalid content won't publish.** By design — a public object must validate
  before it can go live (drafts are always allowed). Fix the flagged fields or leave
  it a draft.

---

## Going further

- **Host the editor** (instead of running it locally): `pnpm --filter @timber/app
  build` produces a static bundle in `packages/app/dist/`. Deploy it to any static
  host (its own GitHub Pages repo, Cloudflare Pages, etc.), then update the OAuth App
  callback, the broker's `ALLOWED_ORIGIN`, and the app's `VITE_*` env to that stable
  URL. Rebuild the app after changing its env (Vite inlines env at build time).
- **Pin Timber** to a release tag in the content repo's `deploy.yml` (`TIMBER_REF`)
  so your site's build never drifts.
- **Custom domain:** add it under the content repo's **Settings → Pages**, then set
  `baseUrl` in `content/settings/index.md` to the custom domain.

---

## Appendix A — Skip OAuth, paste a PAT

To try the editor with **zero** OAuth/Cloudflare setup:

1. Leave `VITE_TIMBER_OAUTH_*` **unset** in `packages/app/.env` (only set
   `VITE_TIMBER_OWNER` / `VITE_TIMBER_REPO`).
2. `pnpm --filter @timber/app dev`.
3. Create a **fine-grained PAT** (GitHub → Settings → Developer settings → Fine-grained
   tokens) scoped to your content repo with **Contents: Read and write**, and paste it
   into the editor's gate.

This is the dev path (the token is kept in `localStorage`). The OAuth flow above is
the proper end-user setup; the PAT is a fast on-ramp.
