# @timber/oauth-broker

The one server-side piece Timber needs. Timber's editor is a static SPA on GitHub
Pages, but GitHub's OAuth **token exchange requires the client secret** (still true
under PKCE — GitHub doesn't yet distinguish public clients) and its token endpoint
**sends no CORS headers**. So the browser can't complete sign-in alone. This tiny,
stateless worker does exactly one thing: trade the OAuth `code` for an access token,
holding the secret server-side. No database, no sessions.

Works with either a classic **OAuth App** or a **GitHub App** — the code→token
endpoint is identical. A **GitHub App is recommended** (per-repo, least-privilege,
short-lived tokens); the full GitHub App + multi-site walkthrough is in
**[`docs/auth-github-app.md`](../../docs/auth-github-app.md)**. The steps below cover
the broker mechanics common to both.

```
Browser (Pages) ──code──▶ broker ──code + client_secret──▶ github.com/login/oauth/access_token
Browser (Pages) ◀─token── broker ◀──────────── access_token ──────────────
```

## One-time setup

### 1. Register an App
GitHub → Settings → Developer settings → **GitHub Apps** (recommended) **or OAuth
Apps** → New.
- **Authorization callback URL:** your editor's URL, e.g. `https://you.github.io/your-site/`
  (the SPA handles the `?code` itself, so the callback is the app's own URL). Add
  `http://localhost:5173/` for dev.
- Copy the **Client ID** (public) and generate a **Client secret** (private).
- For a GitHub App: set repo permissions (Contents R/W, Actions R/W, Pages R, Metadata
  R), enable **Expire user authorization tokens**, and **install it** on your repo(s).

### 2. Deploy the broker (Cloudflare Workers)
```sh
cd packages/oauth-broker
npx wrangler secret put OAUTH_CLIENT_SECRET   # paste the secret — never committed
npx wrangler deploy --var OAUTH_CLIENT_ID:<client-id> \
  --var ALLOWED_ORIGINS:"https://you.github.io, https://blog.example"
```
(Or set `OAUTH_CLIENT_ID` / `ALLOWED_ORIGINS` under `[vars]` in `wrangler.toml`.)
`ALLOWED_ORIGINS` is a **comma-separated** list of the **exact** origins of your editor
site(s) (scheme + host, no path, no trailing slash) — one App + one broker can serve
several sites; every other origin is rejected. (The legacy single `ALLOWED_ORIGIN` is
still honoured.)

> **Env var names are `OAUTH_*`, not `GITHUB_*`.** GitHub Actions **reserves** the
> `GITHUB_` prefix, so a `GITHUB_`-named secret/variable can't be created in a workflow —
> and the broker is usually deployed from one. If your broker predates this and was set
> up with `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, those are still read as a fallback.
> When deploying via a workflow, store the value in an Actions secret named e.g.
> `OAUTH_CLIENT_SECRET` (no `GITHUB_` prefix) and pass it through to the Worker.

### 3. Point the app at the broker
Edit the site's runtime `config.js` (a copy of `packages/app/public/config.js`, served
next to the editor) — no rebuild, no build vars:
```js
window.__TIMBER_CONFIG__ = {
  owner: 'you',
  repo: 'your-content-repo',
  oauth: {
    clientId: '<client-id>',
    brokerUrl: 'https://timber-oauth-broker.<you>.workers.dev',
    scope: '',   // empty for a GitHub App; 'repo' for a classic OAuth App
  },
};
```
With client id + broker set, the app shows **Sign in with GitHub**. Omit the `oauth`
block ⇒ it falls back to the dev paste-a-PAT gate. (Legacy `VITE_*` build vars still
work as a fallback — see `docs/auth-github-app.md`.)

## Endpoint
`POST /` with JSON `{ code, code_verifier, redirect_uri }` → `{ access_token, token_type, scope }`.
`code_verifier` is **required** (PKCE enforced). `OPTIONS` is handled for CORS
preflight. Only an allow-listed origin is accepted.

## Portability
All logic is in `src/handler.ts` as a web-standard `fetch` handler; `src/worker.ts`
is just the Cloudflare glue. To run elsewhere (Deno Deploy, Netlify/Vercel edge),
call `handleRequest(request, env)` from that host's entry point with the same three
env values.

## Security notes
- The client secret lives only in the worker's secret store — never in the browser
  bundle, never in git.
- The broker is stateless and holds no tokens; it relays one request and forgets.
- **PKCE is enforced:** an exchange without a `code_verifier` is rejected, so a stolen
  `code` alone can't be redeemed.
- Origin allowlist + reflected CORS (never `*`) stop other *websites* from driving the
  broker from a victim's browser. This is **anti-CSRF hardening, not authentication** —
  the `Origin` header is spoofable by non-browser clients; the client secret + PKCE +
  GitHub's short code TTL are what actually protect the exchange.
- Nothing is logged, so the secret and token never reach logs.
