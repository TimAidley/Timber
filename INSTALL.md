# Installing Timber

Two ways to stand up a Timber site:

- **[Fork and go](#fork-and-go-no-local-setup)** — the easy path: create a repo from the
  template, register a GitHub App, add a few secrets, run one Action. No terminal, no
  local clone. **Recommended.**
- **[Local / advanced](#appendix--local--advanced-setup)** — clone the repo and drive
  everything by hand (useful for development), including a **paste-a-PAT quick-start**
  with no cloud setup at all.

Both produce the same thing: a public website on GitHub Pages plus an in-browser editor.
There are three moving parts either way:

1. **Content repo** — your site's source (from the template). A GitHub Action builds it
   and deploys to **GitHub Pages** → your public website.
2. **OAuth broker** — a tiny **Cloudflare Worker** holding your app's client secret (the
   one server-side piece; a static SPA can't finish GitHub's OAuth alone).
3. **Editor app** — the Timber SPA, co-hosted at `/<repo>/admin/` on the same Pages site.

The only irreducibly-manual bits are your own accounts/credentials: a **Cloudflare
account + API token**, a **GitHub App** registration, and pasting a few **secrets** into
the repo. Everything else is automated.

> **Why a GitHub App (not a classic OAuth App)?** A GitHub App installs on **only the
> repo(s) you choose** with **least-privilege** permissions and **short-lived** tokens —
> so a leaked token can touch only that repo, not your whole account. One App can serve
> **several** of your sites. (A classic OAuth App also works with this template — see
> [Using a classic OAuth App instead](#using-a-classic-oauth-app-instead) — but its only
> scope for private-repo writes is account-wide `repo`, which is why the App is preferred.)

---

## Fork and go (no local setup)

Your site will live at `https://<you>.github.io/<repo>/` and the editor at
`https://<you>.github.io/<repo>/admin/`. Replace `<you>` (your GitHub login) and `<repo>`
(the repo name you pick) throughout. **The `<you>` in URLs is always lowercase** (that's
how GitHub serves Pages), even if your login has capitals.

### 1. Create your content repo from the template
Go to **[`TimAidley/Timber-site-template`](https://github.com/TimAidley/Timber-site-template)**
→ **“Use this template” → Create a new repository**. Name it `<repo>`. Make it public
(GitHub Pages on the free plan needs a public repo).

### 2. Enable Pages
In your new repo: **Settings → Pages → Source: “GitHub Actions.”**

### 3. Register a GitHub App
**GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.** Fill in:

- **GitHub App name:** anything unique, e.g. `timber-editor-<you>`.
- **Homepage URL:** anything valid, e.g. `https://<you>.github.io/<repo>/`.
- **Callback URL:** `https://<you>.github.io/<repo>/admin/` — **exactly**, trailing slash
  included. (This is where GitHub returns you after sign-in; the editor lives here.)
- **Expire user authorization tokens:** **checked** (recommended — tokens last ~8h; you
  re-sign-in with a quick redirect afterwards). Uncheck it only if you'd rather stay
  signed in until you explicitly sign out.
- **Webhook → Active:** **uncheck.** If the form still refuses to save without a Webhook
  URL, type `https://example.com` — with Active off and no events subscribed, nothing is
  ever sent there; it's only to satisfy the form.
- **Where can this be installed?** **Only on this account.**
- **Repository permissions** (leave everything else “No access”):
  - **Contents** → **Read and write**
  - **Actions** → **Read and write**
  - **Metadata** → **Read-only** (auto-selected)
- Click **Create GitHub App.**
- On the app page: copy the **Client ID**, then **Generate a client secret** and copy it
  (you can't see it again).

> Reusing one App for several sites? Skip re-registering — just **add** this repo's
> `…/admin/` callback URL to the existing App's callback list, and install it on the new
> repo (next step).

### 4. Install the App on your repo
On the app's page → **Install App** → your account → **Only select repositories** →
choose **`<repo>`** → Install. (This is what actually grants the token access to the repo.
If GitHub says the app “does not need repository access,” your permissions in step 3
didn't save — go back and set Contents/Actions.)

### 5. Add secrets + variables
Your repo → **Settings → Secrets and variables → Actions**. Add these (use the exact
names — note the `GH_` prefix; GitHub **forbids** names starting with `GITHUB_`):

| Tab | Name | Value |
|---|---|---|
| **Variables** | `GH_OAUTH_CLIENT_ID` | the App's **Client ID** (public) |
| **Secrets** | `GH_OAUTH_CLIENT_SECRET` | the App's **client secret** |
| **Secrets** | `CLOUDFLARE_API_TOKEN` | Cloudflare token with **Workers Scripts: Edit** |
| **Secrets** | `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare **account id** |

For the Cloudflare values: Cloudflare dashboard → **Workers & Pages** (the free plan is
fine). The **account id** is on the Workers overview page; create the **API token** from
**My Profile → API Tokens → Create Token → “Edit Cloudflare Workers”** template. Ensure a
**workers.dev subdomain** is enabled for your account (Workers & Pages → Subdomain).

### 6. Set your base URL
Edit **`content/settings/index.md`** → set `baseUrl: https://<you>.github.io/<repo>` (no
trailing slash) and commit. This makes links, canonical URLs, and the sitemap correct
under the repo's subpath.

### 7. Run “Setup OAuth broker”
**Actions → “Setup OAuth broker” → Run workflow.** It:
1. deploys your Cloudflare broker with the App's credentials,
2. commits the broker's URL to `.timber-broker-url` (public — it holds no secret),
3. triggers the **Build & deploy site** workflow.

When **Build & deploy site** goes green, open **`https://<you>.github.io/<repo>/admin/`**,
click **Sign in with GitHub**, **authorize the App**, and start editing. **Publish**
squash-merges your changes to `main`, which auto-deploys.

### How it fits together
```
Use template ─▶ register + install GitHub App ─▶ add secrets ─▶ run "Setup OAuth broker"
                                                                     │  deploys broker,
                                                                     │  records its URL
                                        "Build & deploy": site (/) + editor (/admin/) ─▶ Pages
```
The editor's URL/callback (`…/<repo>/admin/`) and the broker's allowed origin
(`https://<you>.github.io`) both follow from your repo name — nothing to guess. One App +
one broker can serve several of your sites (each site adds its own `…/admin/` callback URL
and installs the App).

### Troubleshooting
- **App “does not need repository access” at install** → the repository permissions
  didn't save in step 3. Edit the App → **Permissions & events** → set **Contents:
  Read & write** and **Actions: Read & write** → **Save**, then accept the updated
  permissions on the installation.
- **Can create the App but sign-in produces a token with no repo access** → the App isn't
  installed on the repo (step 4), or the install is on “All repositories” without your
  repo selected.
- **“Secret names must not start with GITHUB_”** → use the `GH_OAUTH_*` names in step 5,
  not `GITHUB_*` (GitHub reserves that prefix).
- **Setup fails reading your workers.dev subdomain** → enable workers.dev for your
  Cloudflare account (Workers & Pages → Subdomain), then re-run “Setup OAuth broker.”
- **Sign-in `redirect_uri` mismatch** → the App's callback URL must equal
  `https://<you>.github.io/<repo>/admin/` **exactly** (trailing slash, lowercase host).
- **`origin_not_allowed` on sign-in** → the broker's allowed origin didn't match; it's
  derived as `https://<you>.github.io`. On a **custom domain**, set the broker's
  `ALLOWED_ORIGINS` to that origin (see the broker README) and re-run Setup.
- **Deploy fails at “Check out Timber”** → the `TimAidley/Timber` repo must be public (the
  Action checks it out anonymously).
- **CSS/links 404 on the live site** → confirm `baseUrl` in `content/settings/index.md`
  includes the `/<repo>` subpath (step 6).
- **Pages 404 after a green deploy** → confirm **Settings → Pages → Source = GitHub
  Actions** and give it a minute.

### Alternative sign-in: device flow (no client secret)
Don't want to hold a client secret? Use the **device flow** instead of the redirect
flow. It's a public-client sign-in, so **no client secret exists** — the broker is only
a secret-less relay (needed because GitHub's device endpoints, like its token endpoint,
send no CORS). Changes from the steps above:

- On the GitHub App: **General → Enable Device Flow** (tick it).
- Step 3's **Callback URL** is irrelevant to this flow (device flow has no redirect) —
  you can leave it set; it's just unused.
- Step 5: you can **omit `GH_OAUTH_CLIENT_SECRET`** — there's no secret. Keep the
  Cloudflare secrets (`CLOUDFLARE_*`) and `GH_OAUTH_CLIENT_ID`; the relay still deploys.
- Add one repo **Variable**: `TIMBER_OAUTH_FLOW` = `device` (Settings → Secrets and
  variables → Actions → Variables). The deploy builds the editor in device-flow mode.
  Then re-run **Setup OAuth broker** (or **Build & deploy site**).

(Self-hosting the editor instead of the fork-and-go deploy? Set `flow: 'device'` in the
`oauth` block of your `config.js` rather than a repo variable.)

**How sign-in looks:** the editor shows a short code (e.g. `WDJB-MJHT`), opens
`github.com/login/device` in a tab; you enter the code, approve, and you're in. One
extra step than the redirect, in exchange for zero secret to manage. Full detail:
[`docs/auth-github-app.md`](docs/auth-github-app.md).

### Using a classic OAuth App instead
Prefer a classic OAuth App? It works with the same template and the same secret/variable
names (`GH_OAUTH_CLIENT_ID` / `GH_OAUTH_CLIENT_SECRET`). Register it under **Developer
settings → OAuth Apps** with the same callback URL, skip the install step (OAuth Apps
aren't “installed”), and grant the `repo` scope when prompted at first sign-in. The
trade-off: that scope is **account-wide**, which is exactly what the GitHub App avoids.

---

## Appendix — Local / advanced setup

For development, or to run the editor on your own machine. Replace `<owner>` /
`<site-repo>` / `<editor-origin>` (e.g. `http://localhost:5173`) throughout.

**Prerequisites:** Node ≥ 20, pnpm 10 (`npm i -g pnpm@10`), git, a clone of the Timber
repo.

### A. Create the content repo from `site-template/`
```sh
cp -r /path/to/Timber/site-template <site-repo> && cd <site-repo>
git init -b main && git add -A && git commit -m "Seed site from Timber site-template"
git remote add origin https://github.com/<owner>/<site-repo>.git
git push -u origin main
```
Set `baseUrl` in `content/settings/index.md`, enable **Pages → GitHub Actions**, and the
push deploys your site at `https://<owner>.github.io/<site-repo>/`.

### B. Deploy the broker by hand
```sh
cd /path/to/Timber/packages/oauth-broker
npx wrangler login
npx wrangler secret put OAUTH_CLIENT_SECRET         # paste the App's client secret
npx wrangler deploy \
  --var OAUTH_CLIENT_ID:<client-id> \
  --var ALLOWED_ORIGINS:<editor-origin>             # exact origin, no path/slash
```
`ALLOWED_ORIGINS` is scheme+host only (e.g. `http://localhost:5173`); list several
comma-separated to serve multiple sites from one broker. Copy the printed `*.workers.dev`
URL. (The env var names are `OAUTH_*`, not `GITHUB_*`, because GitHub Actions reserves the
`GITHUB_` prefix; the broker still reads legacy `GITHUB_CLIENT_ID/SECRET` if you set those.)

### C. Run the editor locally
Two ways to give the editor its config. **Runtime `config.js`** (no rebuild): edit
`packages/app/public/config.js` — it ships empty, so uncomment the `window.__TIMBER_CONFIG__`
block and fill it in (Vite serves it at `/config.js`).

Or use **build env vars** — `cp packages/app/.env.example packages/app/.env` and set:
```ini
VITE_TIMBER_OWNER=<owner>
VITE_TIMBER_REPO=<site-repo>
VITE_TIMBER_OAUTH_CLIENT_ID=<client-id>
VITE_TIMBER_OAUTH_BROKER_URL=https://timber-oauth-broker.<you>.workers.dev
# VITE_TIMBER_OAUTH_SCOPE=       # leave unset for a GitHub App (scope is ignored); 'repo' for an OAuth App
```
Then `pnpm --filter @timber/app dev`. Vite serves at **http://localhost:5173/** — it must
match the App's callback and the broker's `ALLOWED_ORIGINS` exactly. Register the App's
callback as `http://localhost:5173/` and (for a GitHub App) install it on your repo.
Restart `dev` after `.env` changes.

### Appendix A — Skip OAuth, paste a PAT
To try the editor with **zero** OAuth/Cloudflare setup: leave `VITE_TIMBER_OAUTH_*` unset
(and no `config.js` OAuth block), run `pnpm --filter @timber/app dev`, and paste a
**fine-grained PAT** (GitHub → Settings → Developer settings → Fine-grained tokens) scoped
to your repo with **Contents: Read and write**. The token is kept in `localStorage` — a
dev convenience; the GitHub App is the proper end-user path.

### Going further
- **Custom domain / user site:** if the site is served at a root (a `<you>.github.io`
  repo, or a custom domain), `baseUrl` has no subpath and `basePath` is empty — links work
  at `/`. Set the App's callback + the broker's `ALLOWED_ORIGINS` to that origin.
- **Pin Timber:** set `TIMBER_REF` in the workflows to a Timber release tag so the build
  never drifts from the app version your content was authored against.
