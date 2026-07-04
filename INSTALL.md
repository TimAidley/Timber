# Installing Timber

Two ways to stand up a Timber site:

- **[Fork and go](#fork-and-go-no-local-setup)** — the easy path: fork a template, add a
  few secrets, run one Action. No terminal, no local clone. Recommended.
- **[Local / advanced](#appendix--local--advanced-setup)** — clone the repo and drive
  everything by hand (useful for development or for understanding the moving parts),
  including a **paste-a-PAT quick-start** with no cloud setup at all.

Both produce the same thing: a public website on GitHub Pages plus an in-browser editor.
There are three moving parts either way:

1. **Content repo** — your site's source (from the starter). A GitHub Action builds it
   and deploys to **GitHub Pages** → your public website.
2. **OAuth broker** — a tiny **Cloudflare Worker** holding your GitHub client secret (the
   one server-side piece; a static SPA can't finish GitHub OAuth alone).
3. **Editor app** — the Timber SPA, co-hosted at `/<repo>/admin/` on the same Pages site.

The only irreducibly-manual bits are your own accounts/credentials: a **Cloudflare
account + API token**, a **GitHub OAuth App** registration, and pasting a few **secrets**
into the repo. Everything else is automated.

---

## Fork and go (no local setup)

Your site will live at `https://<you>.github.io/<repo>/` and the editor at
`https://<you>.github.io/<repo>/admin/`.

### 1. Use the template
From the **`timber-starter`** repo, click **“Use this template” → Create a new
repository** (or Fork). Name it anything.

### 2. Enable Pages
In your new repo: **Settings → Pages → Source: “GitHub Actions.”**

### 3. Register a GitHub OAuth App
**GitHub → Settings → Developer settings → OAuth Apps → New OAuth App:**
- **Homepage URL** and **Authorization callback URL:** `https://<you>.github.io/<repo>/admin/`
  — exactly, trailing slash included.
- Copy the **Client ID**; generate a **Client secret**.

### 4. Add secrets + variables
Your repo → **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
|---|---|---|
| Variable | `GH_OAUTH_CLIENT_ID` | OAuth App **client id** (public) |
| Secret | `GH_OAUTH_CLIENT_SECRET` | OAuth App **client secret** |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare token with **Workers Scripts: Edit** |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare **account id** |

(From the Cloudflare dashboard → Workers. Free plan is fine; ensure a **workers.dev
subdomain** is enabled for your account.)

### 5. Set your base URL
Edit `content/settings/index.md` → `baseUrl: https://<you>.github.io/<repo>` (no trailing
slash) and commit. This makes links, canonical URLs, and the sitemap correct under the
repo's subpath.

### 6. Run “Setup OAuth broker”
**Actions → “Setup OAuth broker” → Run workflow.** It deploys the Cloudflare broker,
commits its URL to `.timber-broker-url`, and triggers a deploy. When **Build & deploy
site** goes green, open `https://<you>.github.io/<repo>/admin/`, **Sign in with GitHub**,
and start editing. Publish → auto-deploys.

### How it fits together
```
Use template ─▶ add secrets ─▶ run "Setup OAuth broker" ─▶ deploys broker + commits URL
                                                                │
                                    "Build & deploy": site (/) + editor (/admin/) ─▶ Pages
```
The editor's URL/callback (`…/<repo>/admin/`) and the broker's allowed origin
(`https://<you>.github.io`) are both determined by your repo name — nothing to guess.

### Troubleshooting
- **Setup fails reading your workers.dev subdomain** → enable workers.dev for your
  Cloudflare account, then re-run “Setup OAuth broker.”
- **Sign-in `redirect_uri` mismatch** → the OAuth App callback must equal
  `https://<you>.github.io/<repo>/admin/` exactly (trailing slash).
- **`origin_not_allowed` on sign-in** → the broker's `ALLOWED_ORIGIN` didn't match; it's
  derived as `https://<you>.github.io`. Custom domain? Set `ALLOWED_ORIGIN` accordingly
  (see the broker README) and re-run Setup.
- **Deploy fails at “Check out Timber”** → the `TimAidley/Timber` repo must be public (the
  Action checks it out anonymously).
- **CSS/links 404 on the live site** → confirm `baseUrl` in `content/settings/index.md`
  includes the `/<repo>` subpath (step 5).
- **Pages 404 after a green deploy** → confirm **Settings → Pages → Source = GitHub
  Actions** and give it a minute.

---

## Appendix — Local / advanced setup

For development, or to run the editor on your own machine. Replace `<owner>` /
`<site-repo>` / `<editor-origin>` (e.g. `http://localhost:5173`) throughout.

**Prerequisites:** Node ≥ 20, pnpm 10 (`npm i -g pnpm@10`), git, a clone of the Timber
repo.

### A. Create the content repo from `starter/`
```sh
cp -r /path/to/Timber/starter <site-repo> && cd <site-repo>
git init -b main && git add -A && git commit -m "Seed site from Timber starter"
git remote add origin https://github.com/<owner>/<site-repo>.git
git push -u origin main
```
Set `baseUrl` in `content/settings/index.md`, enable **Pages → GitHub Actions**, and the
push deploys your site at `https://<owner>.github.io/<site-repo>/`.

### B. Deploy the broker by hand
```sh
cd /path/to/Timber/packages/oauth-broker
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_SECRET        # paste the OAuth App secret
npx wrangler deploy \
  --var GITHUB_CLIENT_ID:<client-id> \
  --var ALLOWED_ORIGIN:<editor-origin>              # exact origin, no path/slash
```
`ALLOWED_ORIGIN` is scheme+host only (e.g. `http://localhost:5173`). Copy the printed
`*.workers.dev` URL.

### C. Run the editor locally
```sh
cd /path/to/Timber
pnpm install
cp packages/app/.env.example packages/app/.env
```
Set in `packages/app/.env`:
```ini
VITE_TIMBER_OWNER=<owner>
VITE_TIMBER_REPO=<site-repo>
VITE_TIMBER_OAUTH_CLIENT_ID=<client-id>
VITE_TIMBER_OAUTH_BROKER_URL=https://timber-oauth-broker.<you>.workers.dev
```
Then `pnpm --filter @timber/app dev`. Vite serves at **http://localhost:5173/** — it must
match the OAuth callback and `ALLOWED_ORIGIN` exactly. Register the OAuth App callback as
`http://localhost:5173/`. Restart `dev` after `.env` changes.

### Appendix A — Skip OAuth, paste a PAT
To try the editor with **zero** OAuth/Cloudflare setup: leave `VITE_TIMBER_OAUTH_*` unset,
run `pnpm --filter @timber/app dev`, and paste a **fine-grained PAT** (GitHub → Settings →
Developer settings → Fine-grained tokens) scoped to your repo with **Contents: Read and
write**. The token is kept in `localStorage` — a dev convenience; OAuth is the proper
end-user path.

### Going further
- **Custom domain / user site:** if the site is served at a root (a `<you>.github.io`
  repo, or a custom domain), `baseUrl` has no subpath and `basePath` is empty — links work
  at `/`. Set the OAuth callback + broker `ALLOWED_ORIGIN` to that origin.
- **Pin Timber:** set `TIMBER_REF` in the workflows to a Timber release tag so the build
  never drifts.
