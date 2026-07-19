# Set up a Timber site

This stands up a **hosted** site with no local tooling: a public website on GitHub Pages
at `https://<you>.github.io/<repo>/`, plus an in-browser editor at
`https://<you>.github.io/<repo>/edit/`. You create a repo from a template, choose how you
sign in, and let a GitHub Action do the rest.

> Want to run the editor on your own machine, build a site by hand, or hack on Timber
> itself? See **[`DEVELOPMENT.md`](DEVELOPMENT.md)** instead.

Throughout, `<you>` is your GitHub login (**lowercase** in URLs — that's how Pages serves
them) and `<repo>` is the repo name you pick.

> **Editor path.** The editor lives at `/edit/` by default. To use a different path (e.g.
> a content page already occupies `/edit/`), set a repo **Variable** `TIMBER_EDITOR_PATH`
> (Settings → Secrets and variables → Actions) to your chosen segment, and use *that* path
> everywhere `/<repo>/edit/` appears below — including the GitHub App's callback URL.

---

## 1. Choose how you sign in to the editor

The editor commits to your repo on your behalf, so it has to authenticate to GitHub.
There are three ways — pick one now (you can switch later):

| Method | Setup effort | Login experience | Security |
|---|---|---|---|
| **Paste a PAT** | **Lowest** — no cloud services at all | Paste a token once per browser (until it expires) | You hold a token in the browser's `localStorage`; you scope it to just this repo and choose its expiry |
| **GitHub App + broker** (redirect) | **Highest** — a Cloudflare Worker *and* a GitHub App | One click: **Sign in with GitHub** → redirect back | Per-repo, short-lived tokens; a client **secret** is held server-side in the broker |
| **GitHub App + device flow** | **Medium** — a Cloudflare relay + a GitHub App, but **no secret** | Enter a short code at `github.com/login/device`, approve | Per-repo, short-lived tokens; **no client secret anywhere** |

**How to choose:**
- **Just you, least fuss?** → **Paste a PAT.** Nothing to deploy; the trade-off is you paste (and periodically renew) a token.
- **Want a real "Sign in with GitHub" button without holding a secret?** → **device flow.**
- **Want the smoothest one-click login and don't mind holding a secret?** → **redirect.**

The two GitHub-App methods are more secure (per-repo, short-lived tokens) but need a
**Cloudflare** account for the broker. Paste-a-PAT needs no cloud services at all.

---

## 2. Common setup (do this for every method)

### 2.1 Create your repo from the template
Go to **[`TimAidley/Timber-site-template`](https://github.com/TimAidley/Timber-site-template)**
→ **"Use this template" → Create a new repository**. Name it `<repo>`; make it **public**
(GitHub Pages on the free plan needs a public repo).

### 2.2 Enable Pages
In your new repo: **Settings → Pages → Source: "GitHub Actions."**

### 2.3 Set your base URL
Edit **`content/settings/index.md`** → `baseUrl: https://<you>.github.io/<repo>` (no
trailing slash) and commit. This makes links, canonical URLs, and the sitemap correct
under the repo's subpath. (Committing it also kicks off the first deploy.)

### 2.4 (Optional) Multiple languages
Timber is single-language unless you opt in. To run the site in more than one language,
add a `languages` list (and a `defaultLanguage`) to **`content/settings/index.md`** — this
turns on per-language URLs (`/<lang>/…`), an **Add translation** action in the editor, and a
theme language switcher. It's a deliberate step (it moves existing page URLs under a
language prefix), so read **[docs/multilingual.md](docs/multilingual.md)** before enabling.

That's all three methods share. Now follow **the one section below** for your choice.

---

## 3a. Finish setup — Paste a PAT

> **Follow this section only if you chose paste-a-PAT.** No Cloudflare, no GitHub App.

1. Make sure the **Build & deploy site** Action has run (committing `baseUrl` above triggers
   it; or Actions → **Build & deploy site** → Run workflow). It ships the site *and* the
   editor — with no broker configured, the editor uses paste-a-PAT.
2. Create a **fine-grained PAT**: GitHub → Settings → Developer settings → **Fine-grained
   tokens** → scope it to **`<repo>`** with **Contents: Read & write** (add **Actions: Read
   & write** so the editor can show deploy status and re-run failed deploys). Pick an
   expiry you're comfortable with.
3. Open `https://<you>.github.io/<repo>/edit/`, paste the token, and start editing.

You're done. (The token lives in that browser's `localStorage`; you'll re-paste when it
expires or on a new browser.)

---

## 3b. Finish setup — GitHub App (redirect **or** device flow)

Both App methods need the same two building blocks — **Cloudflare** and a **GitHub App** —
then one small per-method difference. Do 3b.1 → 3b.4 in order.

### 3b.1 Cloudflare (hosts the broker)

> **Follow this if you chose redirect *or* device flow.** (Skip it entirely for paste-a-PAT.)

The broker is a tiny Cloudflare **Worker**. The free plan is plenty.

1. Create a free account at **[dash.cloudflare.com](https://dash.cloudflare.com)** if you
   don't have one.
2. **Workers & Pages** → ensure a **workers.dev subdomain** is enabled for your account
   (Workers & Pages → *Subdomain*). The setup fails without one.
3. Copy your **Account ID** (Workers & Pages overview, right-hand side).
4. Create an **API token**: My Profile → **API Tokens** → **Create Token** → use the
   **"Edit Cloudflare Workers"** template → Create → copy the token.

Hold on to the **Account ID** and **API token** for 3b.3.

### 3b.2 Register + install a GitHub App

> **Follow this if you chose redirect *or* device flow.**

GitHub → Settings → Developer settings → **GitHub Apps** → **New GitHub App**:
- **Callback URL:** `https://<you>.github.io/<repo>/edit/` — exactly, trailing slash (use
  your `TIMBER_EDITOR_PATH` here if you changed it).
- **Expire user authorization tokens:** **checked** (short-lived tokens; recommended).
- **Webhook → Active:** **unchecked** (if the form demands a URL, put `https://example.com`).
- **Where can this be installed?** **Only on this account.**
- **Repository permissions** (nothing else): **Contents: Read & write**, **Actions: Read &
  write**, **Metadata: Read** (auto).
- > **Device flow only:** also tick **Enable Device Flow** (on the General page).
- Create it, copy the **Client ID**, and generate a **Client secret**.
- **Install App** → your account → **Only select repositories** → **`<repo>`**. (The
  install is what actually grants access to the repo.)

### 3b.3 Add secrets & variables

In your repo → **Settings → Secrets and variables → Actions**. Use these exact names
(the `GH_` prefix matters — GitHub forbids names starting with `GITHUB_`):

| Kind | Name | Value |
|---|---|---|
| Variable | `GH_OAUTH_CLIENT_ID` | the App's **Client ID** |
| Secret | `CLOUDFLARE_API_TOKEN` | from 3b.1 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | from 3b.1 |

…plus the one bit that differs by method:

> **Redirect flow:** add a **Secret** `GH_OAUTH_CLIENT_SECRET` = the App's client secret,
> and leave `TIMBER_OAUTH_FLOW` unset.

> **Device flow:** add a **Variable** `TIMBER_OAUTH_FLOW` = `device`. You can **omit**
> `GH_OAUTH_CLIENT_SECRET` entirely — the device flow uses no secret.

### 3b.4 Deploy the broker and sign in

**Actions → "Setup OAuth broker" → Run workflow.** It deploys the Cloudflare broker,
records its URL, and triggers a site deploy. When **Build & deploy site** goes green, open
`https://<you>.github.io/<repo>/edit/` and **Sign in with GitHub**:

> **Redirect flow:** you're bounced to GitHub, approve, and land back signed in.

> **Device flow:** the editor shows a short code and opens `github.com/login/device`; enter
> the code, approve, and it signs you in.

One App + one broker can serve **several** of your sites — reuse them: add each new site's
`…/edit/` callback URL to the App, install it on that repo, and the shared broker already
allows your `https://<you>.github.io` origin.

---

## Troubleshooting

- **App "does not need repository access" at install** → the repository permissions didn't
  save in 3b.2. Edit the App → **Permissions & events** → set **Contents: Read & write** and
  **Actions: Read & write** → Save, then accept the updated permissions on the installation.
- **Sign-in produces a token with no repo access** → the App isn't installed on the repo
  (3b.2), or it's installed on "All repositories" without your repo selected.
- **"Secret names must not start with GITHUB_"** → use the `GH_OAUTH_*` names in 3b.3.
- **Setup fails reading your workers.dev subdomain** → enable it (Cloudflare → Workers &
  Pages → Subdomain), then re-run "Setup OAuth broker."
- **Sign-in `redirect_uri` mismatch** (redirect flow) → the App's callback must equal
  `https://<you>.github.io/<repo>/edit/` exactly (trailing slash, lowercase host).
- **`origin_not_allowed` on sign-in** → the broker's allowed origin didn't match; it's
  derived as `https://<you>.github.io`. On a **custom domain**, set the broker's
  `ALLOWED_ORIGINS` to that origin (see `packages/oauth-broker/README.md`) and re-run Setup.
- **Deploy fails at "Check out Timber"** → the `TimAidley/Timber` repo must be public.
- **CSS/links 404 on the live site** → confirm `baseUrl` includes the `/<repo>` subpath (2.3).
- **Pages 404 after a green deploy** → confirm **Settings → Pages → Source = GitHub Actions**
  and give it a minute.

## Alternative: a classic OAuth App

Prefer a classic OAuth App to a GitHub App? It works with the same template and the same
`GH_OAUTH_*` secret names. Register it under **Developer settings → OAuth Apps** with the
same callback URL, skip the install step (OAuth Apps aren't "installed"), and grant the
`repo` scope at first sign-in. The trade-off: that scope is **account-wide**, which is
exactly what a GitHub App avoids. Deeper reference: **[`docs/auth-github-app.md`](docs/auth-github-app.md)**.

---

## Alternative: host on Codeberg (Gitea / Forgejo)

Timber's git host is a swappable adapter (ARCHITECTURE → "The git host — the `HostProvider`
seam"), and **Codeberg** (Forgejo) is a supported second host. The differences from GitHub:

1. **Deploy is branch-based.** Codeberg Pages serves from a `pages` branch, not an artifact.
   The template ships **`.forgejo/workflows/deploy.yml`** for this — it builds your site and
   force-pushes the output to `pages`, served at `https://<owner>.codeberg.page/<repo>/`.
   (It sits alongside the GitHub workflow; Forgejo reads `.forgejo/`, GitHub ignores it.)
   Enable **Settings → Actions** on your repo; the workflow's header lists the one-time steps.
2. **Base URL.** Set `baseUrl: https://<owner>.codeberg.page/<repo>` in
   `content/settings/index.md` (same subpath idea as GitHub project Pages).
3. **Editor config.** The editor is co-hosted at `/<repo>/edit/` and pointed at Codeberg via
   `host: gitea` + `apiBaseUrl: https://codeberg.org` — the `deploy.yml` sets these build
   vars for you. In a hand-written `config.js` they are `host` and `apiBaseUrl`.
4. **Sign-in.** Two options:
   - **Paste-a-PAT** — zero extra infrastructure. Create a token under **Settings →
     Applications** on Codeberg with contents read/write.
   - **"Sign in with Codeberg" (OAuth).** Register an OAuth2 app (**Settings → Applications
     → Create OAuth2 Application**) as a **public client** (no secret), redirect URI =
     your editor URL (`https://<owner>.codeberg.page/<repo>/edit/`). Deploy Timber's
     broker with `GITEA_BASE_URL=https://codeberg.org` (+ `OAUTH_CLIENT_ID`,
     `ALLOWED_ORIGINS=https://<owner>.codeberg.page`; **no secret needed**), and set the
     editor's `oauth.clientId` + `oauth.brokerUrl`. The broker is required only because
     Codeberg's token endpoint sends no CORS — it holds no secret (Gitea is a public
     client). Set `oauth.scope` to what your token needs (e.g. `write:repository`).

Self-hosted Gitea/Forgejo works the same way — set `apiBaseUrl` to your instance origin
(and `GITEA_BASE_URL` on the broker).
