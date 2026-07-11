# Production auth: GitHub App + shared broker (multi-site)

This is the recommended production sign-in for Timber. It replaces the classic OAuth
App (account-wide `repo` scope) with a **GitHub App** that is installed on just the
repo(s) you edit, issuing **short-lived, least-privilege** user-to-server tokens. One
App + one broker can serve **several of your sites**.

It slots in behind the existing `getToken()` seam — no app/commit/publish code changes
when you switch. You keep the dev paste-a-PAT gate for local work.

## Why a GitHub App (vs the classic OAuth App)

| | Classic OAuth App | GitHub App (this doc) |
|---|---|---|
| Scope of a token | **All** the user's repos (`repo`) | Only the installed repo(s), granular permissions |
| Token lifetime | Non-expiring by default | Short-lived (~8h) with expiry enabled |
| Multi-site | One registration, but broad scope | One registration, installed per repo |
| Public/shared later | Users grant account-wide access | Users install with **scoped** consent |
| Obligation on you | — | **None while private/per-deployer** |

A GitHub App can be kept **private** ("Only on this account"), so adopting it creates
no support surface or dependency on you. If you later want others to use a hosted
instance, you flip the App to public and widen the broker — see "Going shared" below.

## One-time setup

### 1. Register the GitHub App
GitHub → Settings → Developer settings → **GitHub Apps** → **New GitHub App**.

- **Callback URL:** the editor's own URL, e.g. `https://you.github.io/your-site/`
  (the SPA parses `?code` itself). Add one callback per site if you run several, plus
  `http://localhost:5173/` for dev. **Enable "Request user authorization (OAuth) during
  installation"** is optional; what matters is the callback list.
- **Expire user authorization tokens:** **ON** (gives ~8h tokens).
- **Webhook:** not needed — uncheck Active.
- **Where can this be installed?** "Only on this account" (keep it private for now).
- **Repository permissions** (nothing else — the editor's token needs no more):
  - **Contents:** Read & write  — commits via the Git Data API
  - **Actions:** Read & write   — deploy-status reads + `workflow_dispatch` re-run
  - **Metadata:** Read (mandatory, auto-selected)
- Save, then note the **Client ID** and generate a **Client secret**.

### 2. Install it on your repo(s)
App page → **Install App** → your account → **Only select repositories** → pick each
content repo you edit with Timber. (Re-run this to add a repo later; no re-registration.)

### 3. Deploy the broker
The broker needs three values: the App's client id + secret and the origin allowlist.
From `packages/oauth-broker` (local equivalent — most people deploy it from a workflow):

```sh
npx wrangler secret put OAUTH_CLIENT_SECRET       # the App's client secret
npx wrangler deploy --var OAUTH_CLIENT_ID:<client-id> \
  --var ALLOWED_ORIGINS:"https://you.github.io, https://blog.example"
```

`ALLOWED_ORIGINS` is the comma-separated list of your sites' **exact** origins (scheme
+ host, no path). One broker serves them all.

> **Deploying via GitHub Actions?** The env var names are `OAUTH_*`, not `GITHUB_*`,
> because GitHub Actions **reserves** the `GITHUB_` prefix — you cannot create a secret,
> variable, or workflow env var starting with `GITHUB_`. Store the secret in an Actions
> secret named e.g. `OAUTH_CLIENT_SECRET`, then map it to the Worker in your deploy step
> (e.g. `echo "${{ secrets.OAUTH_CLIENT_SECRET }}" | wrangler secret put OAUTH_CLIENT_SECRET`,
> or via `cloudflare/wrangler-action`'s `secrets:` input). The Cloudflare-side names are
> `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET`. (Legacy `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
> are still read if your broker was configured before this rename.)

### 4. Configure each site
The per-site config is just `owner`, `repo`, `clientId`, `brokerUrl` (no secrets — the
client *secret* lives only in the broker). How you supply it depends on how you deploy:

**Fork-and-go (the template — the common path).** The `deploy.yml` workflow bakes the
config into the editor build from repo values: `owner`/`repo` come from the repo itself,
`clientId` from the `GH_OAUTH_CLIENT_ID` **variable**, and `brokerUrl` from the
`.timber-broker-url` the Setup workflow commits. So you set the `GH_OAUTH_CLIENT_ID`
variable (INSTALL step 5) and everything else is automatic — **you do not edit
`config.js`** (the deploy ships an empty one, and would overwrite edits anyway).

**Self-hosting the editor** (you drop a prebuilt Timber build somewhere yourself, no
build step). Then configure it **at runtime** via `config.js` — copy
`packages/app/public/config.js` (which ships empty) next to the editor and fill it in:

```js
window.__TIMBER_CONFIG__ = {
  owner: 'you',
  repo: 'this-sites-content-repo',
  oauth: {
    clientId: '<client-id>',                                   // same App for every site
    brokerUrl: 'https://timber-oauth-broker.<you>.workers.dev',
    scope: '',                                                 // empty for a GitHub App
    // redirectUri: omit — defaults to the editor's own URL (which is the callback).
  },
};
```

`config.js` (runtime, highest priority) wins over `VITE_TIMBER_*` **build** env vars,
which win over defaults. The fork-and-go path uses the build vars; `config.js` is for the
self-hosted path.

## Token handling (current posture)

- The access token is held **in memory + `sessionStorage`** (session-scoped, cleared on
  tab close). A **refresh token is never stored** — on expiry the user re-runs the flow,
  which is normally a single silent redirect because GitHub remembers the authorization.
- The broker **enforces PKCE** (`code_verifier` required) and never logs or echoes the
  secret. The `Origin` allowlist is anti-CSRF hardening, not authentication.

## Alternative: device flow (no client secret)

If you'd rather not hold a client secret at all, use the **device flow** — a
public-client sign-in that needs no secret. Trade-offs and specifics:

- On the GitHub App, tick **Enable Device Flow** (General settings).
- Select the flow the same way you configure the rest (step 4): fork-and-go sets the
  **`TIMBER_OAUTH_FLOW` repo variable** to `device`; a self-hosted editor sets
  `oauth: { ..., flow: 'device' }` in its `config.js`. No `redirectUri` is used (the
  device flow has no callback), and there's **no client secret anywhere**.
- The broker is still needed, but only as a **secret-less relay**: GitHub's device
  endpoints send no CORS, so the browser can't call them directly. The same
  `@timber/oauth-broker` serves `POST /device/code` and `POST /device/token` as
  pass-throughs — you can deploy it **without** `OAUTH_CLIENT_SECRET` if you only use
  device sign-in. One relay can serve all your sites.
- **UX:** the editor shows a short code (e.g. `WDJB-MJHT`), opens `github.com/login/device`
  in a tab, you enter the code + approve, and the editor signs you in. One extra step
  vs the redirect flow, but zero secret to manage.

This is the lightest-dependency "Sign in with GitHub": no per-deployer secret, and the
relay holds nothing. (It still sees tokens transit, so run your own relay or trust the
host — the same as any proxy.)

## Going shared later (deferred — Phase B)

If you decide to let others use one hosted instance without registering their own App:

1. Flip the App to **"Any account"** (public) and, if desired, list it on the
   Marketplace. Users then **install** it on their own repo with scoped consent.
2. Replace the static `ALLOWED_ORIGINS` allowlist with **dynamic origin validation**
   (e.g. accept any `*.github.io` Pages origin, or check the installation), so you're
   not hand-maintaining the list.
3. For zero JS token exposure, move token custody server-side: the broker sets an
   **`HttpOnly` cookie** and proxies GitHub calls, so the token never reaches the
   browser. This is a broker rearchitecture (stateful or encrypted-cookie custody) and
   is the only part that makes the broker a real dependency — hence deferred until you
   actually want the shared model.

None of this requires touching the editor app's commit/publish code; it stays behind
`getToken()` and the per-site build env.
