<!-- GENERATED from docs/install.html by scripts/gen-install-markdown.mjs.
     Do not edit by hand — edit the page and regenerate. -->

# Set up a Timber site

> **This is the printable view.** The [interactive guide](https://timaidley.github.io/Timber/install.html) shows only the steps
> for your combination, fills your account and repo name into every URL and callback, and
> gives you a tick box per step. Below is the same content with every path shown, each
> block labelled with the choices it applies to.

This stands up a **hosted** site with no local tooling: a public website plus an in-browser editor co-hosted beside it. You create a repo from a template, choose how you sign in, and let CI do the rest.

Want to run the editor on your own machine, build a site by hand, or hack on Timber itself? See [DEVELOPMENT.md](DEVELOPMENT.md) instead.

## Choosing a sign-in method

**Not sure which sign-in to pick?** The editor commits to your repo on your behalf, so it has to authenticate. You can switch later.

| Method | Setup effort | Login experience | Security |
|---|---|---|---|
| **Paste a PAT** | **Lowest** — no cloud services at all | Paste a token once per browser (until it expires) | You hold a token in the browser's `localStorage`; you scope it to just this repo and choose its expiry |
| **GitHub App + broker** (redirect) *(GitHub)* | **Highest** — a Cloudflare Worker *and* a GitHub App | One click: **Sign in with GitHub** → redirect back | Per-repo, short-lived tokens; a client **secret** is held server-side in the broker |
| **GitHub App + device flow** *(GitHub)* | **Medium** — a Cloudflare relay + a GitHub App, but **no secret** | Enter a short code at `github.com/login/device`, approve | Per-repo, short-lived tokens; **no client secret anywhere** |
| **Sign in with Codeberg** (OAuth) *(Codeberg or GitLab)* | Medium — a Cloudflare relay, but **no secret** | One click: redirect, approve, land back signed in | Short-lived tokens; a **public** OAuth client, so no secret anywhere |

*(GitHub.)* **Just you, least fuss?** Paste a PAT — nothing to deploy; the trade-off is you paste (and periodically renew) a token. **Want a real "Sign in with GitHub" button without holding a secret?** Device flow. **Want the smoothest one-click login and don't mind holding a secret?** Redirect. The two App methods are more secure (per-repo, short-lived tokens) but need a **Cloudflare** account for the broker.

## 1. Create your repo from the template

*(GitHub.)* Go to [TimAidley/Timber-site-template](https://github.com/TimAidley/Timber-site-template) → **"Use this template" → Create a new repository**. Name it `<repo>`, and make it **public** (GitHub Pages on the free plan needs a public repo).

*(Codeberg or GitLab.)* The template lives on GitHub, so bring a copy of it onto Codeberg: import `https://github.com/TimAidley/Timber-site-template` using your host's repository import (Codeberg: **+ → New Migration**; GitLab: **New project → Import project → Repository by URL**), or push a copy of the template's contents into a new empty repo. Name it `<repo>`.

The template carries the workflows for every host side by side — `.github/workflows/`, `.forgejo/workflows/` and `.gitlab-ci.yml`. Each host reads its own and ignores the others.

## 2. Enable Pages

**Applies to:** GitHub + your host's own Pages

In your new repo: **Settings → Pages → Source: "GitHub Actions."**

## 3. Enable Actions

**Applies to:** Codeberg

Codeberg Pages is **branch-based** — it serves from a `pages` branch rather than an artifact. The template ships `.forgejo/workflows/deploy.yml` for exactly this: it builds your site and force-pushes the output to `pages`, served at `https://<owner>.codeberg.page/<repo>`.

Turn it on under **Settings → Actions** on your repo. The workflow's header comment lists the one-time steps it needs.

## 4. Check CI/CD is on

**Applies to:** GitLab

The template ships `.gitlab-ci.yml`, whose `pages` job builds your site and publishes the `public/` artifact to GitLab Pages at `https://<namespace>.gitlab.io/<project>`. GitLab CI runs it automatically once the file is present — there's nothing to enable unless CI/CD has been disabled for the project.

## 5. Point the deploy at Cloudflare Pages

**Applies to:** Cloudflare Pages

Your source, editor and commits stay on **GitHub** exactly as elsewhere — only the *hosting target* changes. GitHub Actions still runs the build and publishes to Cloudflare via `wrangler`, so the editor's publish status keeps working. There's no need to enable GitHub Pages.

In your repo → **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
|---|---|---|
| Variable | `TIMBER_DEPLOY_TARGET` | `cloudflare` |
| Secret | `CLOUDFLARE_API_TOKEN` | a **custom API token** (see below) |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages overview, right-hand side |
| Variable *(optional)* | `TIMBER_CF_PAGES_PROJECT` | `the repo name` — defaults to the repo name; the workflow creates the project on the first run |

Create the token under **My Profile → API Tokens → Create Token → Create Custom Token** (*not* a template) with **Account · Cloudflare Pages · Edit** and **Account · Account Settings · Read**, scoped under **Account Resources → Include** → your account.

> *(Cloudflare Pages + either GitHub App flow.)* You also chose the GitHub App sign-in, and **both workflows read this same secret** — so the one token needs the union of the permissions: add **Account · Workers Scripts · Edit** as well. A Pages-only token deploys the site fine and then fails "Setup OAuth broker" with `Authentication error [code: 10000]` while uploading the Worker's secrets.

## 6. Set your base URL

Edit `content/settings/index.md` and set `baseUrl` (no trailing slash), then commit. This is what in-page links, canonical URLs and the sitemap are built from.

**baseUrl:** `baseUrl: https://<you>.github.io/<repo>`

*(your host's own Pages + the host's default URL.)* Your site is served under a repo subpath, so the subpath has to be part of `baseUrl` — leaving it out is the usual cause of CSS and links 404-ing on the live site.

*(Cloudflare Pages.)* Cloudflare Pages serves at the **root**, so there's no `/<repo>/` subpath here — and the editor is co-hosted at `/edit/` rather than `/<repo>/edit/`.

*(GitHub.)* Committing this also kicks off the first deploy.

**Your site:** `https://<you>.github.io/<repo>`

**Your editor:** `https://<you>.github.io/<repo>/edit/`

## 7. Point DNS at GitHub

**Applies to:** a domain you own + your host's own Pages

A custom domain serves the site at the **root**, so three things move together — do them in this order.

At your DNS provider, add a `CNAME` record for the subdomain you want (e.g. `www` or `blog`) pointing at `<you>.github.io` — the bare host, no repo, no `https://`. For an *apex* domain (`example.com`, no subdomain) use `A`/`AAAA` records pointing at GitHub's Pages IPs instead; GitHub's "Managing a custom domain" doc lists the current addresses. Give it a few minutes to resolve.

## 8. Tell the repo about the domain

**Applies to:** a domain you own + your host's own Pages

In **one commit**:

- Add a `CNAME` file at the repo root containing just the domain — one line, no scheme, no trailing slash. `deploy.yml` copies it into the published output, which is how GitHub Pages learns the domain; it is also the flag that tells the workflow to build the editor for `/edit/` instead of `/<repo>/edit/`. — **CNAME:** `www.example.com`
- Set `baseUrl` in `content/settings/index.md` to that domain's root. — **baseUrl:** `baseUrl: https://www.example.com`

> These two must agree. `baseUrl` still pointing at the old subpath is the usual cause of every link on the new domain gaining a stray `/<repo>/`.

## 9. Confirm the domain and enforce HTTPS

**Applies to:** a domain you own + your host's own Pages

After the deploy lands, go to **Settings → Pages**, confirm the custom domain shows as configured, and tick **Enforce HTTPS** once the certificate has been issued. It can take a few minutes, and the box stays greyed out until then.

The old `https://<you>.github.io/<repo>/` URL redirects to the new domain, so existing links keep working.

> *(a domain you own + your host's own Pages + either GitHub App flow.)* **The editor URL changed too, so the sign-in setup has to follow.** Update the GitHub App's **Callback URL** to `https://<your-domain>/edit/`, add a repo **Variable** `TIMBER_EDITOR_ORIGIN` = `https://<your-domain>` (origin only — no path, no trailing slash), and re-run **Setup OAuth broker** so the Worker picks it up. Otherwise sign-in fails with a `redirect_uri` mismatch or `origin_not_allowed`.
>
> Set the *variable* rather than editing `ALLOWED_ORIGINS` in the Cloudflare dashboard: Setup rewrites that value on every run, so a dashboard-only edit is silently reverted the next time it runs.

## 10. Attach the domain in Cloudflare

**Applies to:** a domain you own + Cloudflare Pages

Add the domain to the Pages project under **Workers & Pages → your project → Custom domains** and follow Cloudflare's DNS instructions, then set `baseUrl` to it.

**baseUrl:** `baseUrl: https://www.example.com`

> *(a domain you own + Cloudflare Pages + either GitHub App flow.)* The editor URL moves with it: update the GitHub App's **Callback URL** to `https://<your-domain>/edit/`, set the repo **Variable** `TIMBER_EDITOR_ORIGIN` = `https://<your-domain>`, and re-run **Setup OAuth broker**.

## 11. Multiple languages *(optional)*

Timber is single-language unless you opt in. To run the site in more than one language, add a `languages` list (and a `defaultLanguage`) to `content/settings/index.md`. That turns on per-language URLs (`/<lang>/…`), an **Add translation** action in the editor, and a theme language switcher.

It's a deliberate step — it moves existing page URLs under a language prefix — so read [docs/multilingual.md](docs/multilingual.md) before enabling it.

## 12. A paginated listing *(optional)*

Once a collection has more entries than fit on one page, add a `paginate` block to the page that lists it (`paginate: { collection: posts, size: 10 }`) and the build splits it across `/blog/`, `/blog/page/2/`, … with a pager the default theme already renders. See [docs/pagination.md](docs/pagination.md).

## 13. Require the content checks *(recommended)*

**Applies to:** GitHub

The template ships `.github/workflows/validate.yml`, which runs two checks on every pull request (and on pushes to branches other than `main` and your `*_wip` editor branch):

- `timber validate .` — schemas, required fields, references, duplicate ids.
- `timber fmt --check .` — every content file matches the exact form the editor writes. A file that doesn't (a hand-written or imported one) is still *valid* and builds fine, but the editor re-serializes it on load and shows it as modified before you've typed anything — and reverting doesn't clear it. See [AUTHORING.md](https://github.com/TimAidley/Timber-site-template/blob/main/AUTHORING.md).

Those run automatically, but a workflow can only *report* a result — **it can't refuse a push on its own.** To make a failing check actually block a merge go to **Settings → Rules → Rulesets → New ruleset → New branch ruleset**, target the default branch, tick **Require status checks to pass**, and add **Validate content** to the list. (On the older UI: **Settings → Branches → Add branch protection rule** → *Require status checks to pass before merging*.)

> The check only appears in that picker **after it has run at least once**, so open a throwaway pull request first if the list is empty.
>
> This is GitHub-only today — the Codeberg and GitLab setups deploy fine but don't yet ship an equivalent content check.

## 14. Let the first deploy run

**Applies to:** paste-a-PAT + GitHub

Make sure the **Build & deploy site** Action has run — committing `baseUrl` above triggers it, or use **Actions → Build & deploy site → Run workflow**. It ships the site *and* the editor; with no broker configured the editor uses paste-a-PAT.

## 15. Create a token

**Applies to:** paste-a-PAT

*(paste-a-PAT + GitHub.)* GitHub → Settings → Developer settings → **Fine-grained tokens**. Scope it to `<repo>` with **Contents: Read & write**, and add **Actions: Read & write** so the editor can show deploy status and re-run failed deploys. Pick an expiry you're comfortable with.

*(paste-a-PAT + Codeberg.)* On Codeberg: **Settings → Applications** → create a token with contents read/write.

*(paste-a-PAT + GitLab.)* On GitLab: **User settings → Access tokens** → create one with the `write_repository` scope.

## 16. Open the editor and paste it

**Applies to:** paste-a-PAT

**Editor:** `https://<you>.github.io/<repo>/edit/`

Paste the token and start editing. That's it — you're done.

The token lives in that browser's `localStorage`; you'll re-paste when it expires or on a new browser.

## 17. Set up Cloudflare (hosts the broker)

**Applies to:** any one-click sign-in

*(either GitHub App flow.)* The broker is a tiny Cloudflare **Worker**. The free plan is plenty.

*(Sign in with Codeberg/GitLab (OAuth).)* The broker is a tiny Cloudflare **Worker**. The free plan is plenty. It holds **no secret** — Codeberg is a public OAuth client; the broker exists only because the token endpoint sends no CORS headers.

*(any one-click sign-in.)* 1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com) if you don't have one.
2. **Workers & Pages** → ensure a **workers.dev subdomain** is enabled for your account (Workers & Pages → *Subdomain*). The setup fails without one.
3. Copy your **Account ID** (Workers & Pages overview, right-hand side).
4. Create a **custom API token**: My Profile → **API Tokens** → **Create Token**, scroll past the templates to **Create Custom Token** → **Get started**. Give it a name, then add these **Permissions** rows: Under **Account Resources**, choose **Include** → your account. Leave **Zone Resources** untouched (a workers.dev deploy needs no zone). **Continue to summary** → **Create Token** → copy it.
  *(any one-click sign-in.)* - **Account · Workers Scripts · Edit** — deploys the Worker and sets its secret.
  - **Account · Account Settings · Read** — reads your **workers.dev** subdomain.
  - *(any one-click sign-in + Cloudflare Pages.)* **Account · Cloudflare Pages · Edit** — you're also deploying the site to Cloudflare Pages, and both workflows read this same `CLOUDFLARE_API_TOKEN` secret, so one token has to cover both jobs.

Hold on to the **Account ID** and **API token** — you'll paste them in a moment.

## 18. Register and install a GitHub App

**Applies to:** either GitHub App flow

GitHub → Settings → Developer settings → **GitHub Apps** → **New GitHub App**:

- **Callback URL** — exactly this, trailing slash included: — `https://<you>.github.io/<repo>/edit/`
- **Expire user authorization tokens:** **checked** (short-lived tokens; recommended).
- **Webhook → Active:** **unchecked** (if the form demands a URL, put `https://example.com`).
- **Where can this be installed?** **Only on this account.**
- **Repository permissions** (nothing else): **Contents: Read & write**, **Actions: Read & write**, **Metadata: Read** (automatic).
- *(GitHub App — device flow.)* On the General page, also tick **Enable Device Flow**.

Create it and copy the **Client ID**.

*(GitHub App — redirect.)* Then generate a **Client secret** — the redirect flow is the one that needs it.

*(GitHub App — device flow.)* The device flow uses **no client secret**, so there's no need to generate one.

*(either GitHub App flow.)* Then **Install App** → your account → **Only select repositories** → `<repo>`. The install is what actually grants access to the repo — registering the App alone does not.

> *(GitHub App — redirect.)* **Prefer a classic OAuth App?** It works with the same template and the same `GH_OAUTH_*` names. Register it under **Developer settings → OAuth Apps** with the same callback URL, skip the install step (OAuth Apps aren't "installed"), and grant the `repo` scope at first sign-in. The trade-off: that scope is **account-wide**, which is exactly what a GitHub App avoids. Deeper reference: [docs/auth-github-app.md](docs/auth-github-app.md).

## 19. Add the secrets and variables

**Applies to:** either GitHub App flow

In your repo → **Settings → Secrets and variables → Actions**. Use these exact names — the `GH_` prefix matters, because GitHub forbids names starting with `GITHUB_`.

| Kind | Name | Value |
|---|---|---|
| Variable | `GH_OAUTH_CLIENT_ID` | the App's **Client ID** |
| Secret | `CLOUDFLARE_API_TOKEN` | the custom API token you just created |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare Account ID |
| Secret *(GitHub App — redirect)* | `GH_OAUTH_CLIENT_SECRET` | the App's client secret |
| Variable *(GitHub App — device flow)* | `TIMBER_OAUTH_FLOW` | `device` |

*(GitHub App — redirect.)* Leave `TIMBER_OAUTH_FLOW` unset — unset means the redirect flow.

*(GitHub App — device flow.)* You can **omit** `GH_OAUTH_CLIENT_SECRET` entirely: the device flow uses no secret.

## 20. Register an OAuth2 application

**Applies to:** Sign in with Codeberg/GitLab (OAuth) + Codeberg

On Codeberg: **Settings → Applications → Create OAuth2 Application**. Register it as a **public client** — leave "Confidential Client" **unchecked**, so there's no secret anywhere.

**Redirect URI:** `https://<owner>.codeberg.page/<repo>/edit/`

## 21. Add the secrets and variables

**Applies to:** Sign in with Codeberg/GitLab (OAuth) + Codeberg

In your repo → **Settings → Actions → Secrets and variables**:

| Kind | Name | Value |
|---|---|---|
| Variable | `OAUTH_CLIENT_ID` | the OAuth2 application's client ID |
| Variable | `TIMBER_OAUTH_SCOPE` | e.g. `write:repository` |
| Secret | `CLOUDFLARE_API_TOKEN` | the custom API token you just created |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare Account ID |
| Secret | `DEPLOY_TOKEN` | a PAT with `contents:write` |

## 22. Register an OAuth application

**Applies to:** Sign in with Codeberg/GitLab (OAuth) + GitLab

On GitLab: **User settings → Applications**. Register it as a **public** client — leave "Confidential" **unchecked**.

**Redirect URI:** `https://<namespace>.gitlab.io/<project>/edit/`

## 23. Add the CI/CD variables

**Applies to:** Sign in with Codeberg/GitLab (OAuth) + GitLab

In your project → **Settings → CI/CD → Variables** (masked):

| Name | Value |
|---|---|
| `TIMBER_OAUTH_CLIENT_ID` | the application's client ID |
| `TIMBER_OAUTH_SCOPE` | e.g. `api` |
| `CLOUDFLARE_API_TOKEN` | the custom API token you just created |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare Account ID |
| `GITLAB_PUSH_TOKEN` | a token with `write_repository` |

## 24. Deploy the broker

**Applies to:** any one-click sign-in

*(either GitHub App flow.)* **Actions → "Setup OAuth broker" → Run workflow.** It deploys the Cloudflare broker, records its URL, and triggers a site deploy. Wait for **Build & deploy site** to go green.

*(Sign in with Codeberg/GitLab (OAuth) + Codeberg.)* **Actions → "Setup OAuth broker (Codeberg)" → Run workflow.** It deploys the broker in Gitea mode (**no secret**), records its URL, and redeploys the editor with sign-in active. The broker's `GITEA_BASE_URL` and the editor's `oauth.clientId`, `brokerUrl` and `scope` are all wired for you.

*(Sign in with Codeberg/GitLab (OAuth) + GitLab.)* Run the **`setup-oauth-broker`** job from the **Pipelines** page (the ▶ button). It deploys the broker in GitLab mode (**no secret** — GitLab is a public client; the broker is only a CORS relay), records its URL, and redeploys the editor with sign-in active.

## 25. Sign in

**Applies to:** any one-click sign-in

**Editor:** `https://<you>.github.io/<repo>/edit/`

*(GitHub App — redirect.)* Click **Sign in with GitHub**: you're bounced to GitHub, you approve, and you land back signed in.

*(GitHub App — device flow.)* Click **Sign in with GitHub**: the editor shows a short code and opens `github.com/login/device`. Enter the code, approve, and it signs you in.

*(Sign in with Codeberg/GitLab (OAuth).)* Click **Sign in with Codeberg**, approve, and you land back signed in.

*(either GitHub App flow.)* One App plus one broker can serve **several** of your sites — reuse them. Add each new site's `…/edit/` callback URL to the App, install it on that repo, and the shared broker already allows your `https://<you>.github.io` origin.

## Troubleshooting

Every symptom is listed; each one is labelled with the choices it applies to.

- *(either GitHub App flow.)* **App "does not need repository access" at install** → the repository permissions didn't save. Edit the App → **Permissions & events** → set **Contents: Read & write** and **Actions: Read & write** → Save, then accept the updated permissions on the installation.
- *(either GitHub App flow.)* **Sign-in produces a token with no repo access** → the App isn't installed on the repo, or it's installed on "All repositories" without your repo selected.
- *(either GitHub App flow.)* **"Secret names must not start with GITHUB_"** → use the `GH_OAUTH_*` names.
- *(any one-click sign-in.)* **Setup fails reading your workers.dev subdomain** → enable it (Cloudflare → Workers & Pages → Subdomain), then re-run the setup workflow.
- *(GitHub App — redirect.)* **Sign-in `redirect_uri` mismatch** → the App's callback must equal `https://<you>.github.io/<repo>/edit/` exactly — trailing slash, lowercase host.
- *(any one-click sign-in.)* **`origin_not_allowed` on sign-in** → the broker's allowed origin didn't match the origin the editor is served from. Set the repo Variable `TIMBER_EDITOR_ORIGIN` to `https://<you>.github.io` (scheme + host only) and re-run the setup workflow. Editing `ALLOWED_ORIGINS` in the Cloudflare dashboard works until the next Setup run overwrites it.
- *(any one-click sign-in.)* **`Authentication error [code: 10000]` during setup** → the Cloudflare API token is missing **Account · Workers Scripts · Edit**.
- *(GitHub.)* **Deploy fails at "Check out Timber"** → the `TimAidley/Timber` repo must be public.
- **CSS and links 404 on the live site** → confirm `baseUrl` is `https://<you>.github.io/<repo>`, subpath included.
- *(GitHub + your host's own Pages.)* **Pages 404 after a green deploy** → confirm **Settings → Pages → Source = GitHub Actions** and give it a minute.
- *(Cloudflare Pages.)* **The deploy succeeds but the editor's publish status never updates** → you're on the "GitHub Actions builds → `wrangler pages deploy`" model, which is the supported one. Cloudflare's own Git integration can build a Timber site too, but then there's no GitHub Actions run for the editor's status to follow.
- *(Codeberg.)* **The site never appears** → Codeberg Pages serves from the `pages` branch. Check the branch exists and that **Settings → Actions** is enabled.
- *(Codeberg.)* **The Publish button never leaves "Building…"** → expected. Codeberg has no deploy capability behind it, unlike GitHub and GitLab.

## Self-hosted instances

*(Codeberg.)* Self-hosted Gitea/Forgejo works the same way — set `apiBaseUrl` to your instance origin. The workflows derive `GITEA_BASE_URL` from the instance, and `TIMBER_EDITOR_ORIGIN` overrides the editor origin if your Pages domain isn't `<owner>.codeberg.page`.

*(GitLab.)* Self-hosted GitLab works the same way — set `apiBaseUrl` to your instance. Nested groups are handled by `projectPath` (`CI_PROJECT_PATH`), which `.gitlab-ci.yml` sets for you.

*(GitHub.)* Timber's git host is a swappable adapter, and Codeberg (Forgejo) and GitLab are supported alternatives — including self-hosted instances of either. Switch the **Where your source lives** choice above to see their setup.

Background on the seam: [ARCHITECTURE.md](ARCHITECTURE.md) → "The git host — the `HostProvider` seam".
