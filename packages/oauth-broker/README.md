# @timber/oauth-broker

The one server-side piece Timber needs. Timber's editor is a static SPA on GitHub
Pages, but GitHub's OAuth **token exchange requires the client secret** (still true
under PKCE — GitHub doesn't yet distinguish public clients) and its token endpoint
**sends no CORS headers**. So the browser can't complete sign-in alone. This tiny,
stateless worker does exactly one thing: trade the OAuth `code` for an access token,
holding the secret server-side. No database, no sessions.

```
Browser (Pages) ──code──▶ broker ──code + client_secret──▶ github.com/login/oauth/access_token
Browser (Pages) ◀─token── broker ◀──────────── access_token ──────────────
```

## One-time setup

### 1. Register an OAuth App
GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App.
- **Homepage URL / Authorization callback URL:** your editor's URL, e.g.
  `https://you.github.io/your-site/` (the SPA handles the `?code` itself, so the
  callback is the app's own URL). Add a second app or `http://localhost:5173/` for dev.
- Copy the **Client ID** (public) and generate a **Client secret** (private).

### 2. Deploy the broker (Cloudflare Workers)
```sh
cd packages/oauth-broker
npx wrangler secret put GITHUB_CLIENT_SECRET   # paste the secret — never committed
npx wrangler deploy --var GITHUB_CLIENT_ID:<client-id> --var ALLOWED_ORIGIN:https://you.github.io
```
(Or set `GITHUB_CLIENT_ID` / `ALLOWED_ORIGIN` under `[vars]` in `wrangler.toml`.)
`ALLOWED_ORIGIN` must be the **exact** origin of your editor site (scheme + host, no
path, no trailing slash) — the broker rejects every other origin.

### 3. Point the app at the broker
In the editor app's build env (`packages/app/.env` or your host's env):
```
VITE_TIMBER_OAUTH_CLIENT_ID=<client-id>
VITE_TIMBER_OAUTH_BROKER_URL=https://timber-oauth-broker.<you>.workers.dev
```
With both set, the app shows **Sign in with GitHub**. Unset ⇒ it falls back to the
dev paste-a-PAT gate.

## Endpoint
`POST /` with JSON `{ code, code_verifier, redirect_uri }` → `{ access_token, token_type, scope }`.
`OPTIONS` is handled for CORS preflight. Only the allowlisted origin is accepted.

## Portability
All logic is in `src/handler.ts` as a web-standard `fetch` handler; `src/worker.ts`
is just the Cloudflare glue. To run elsewhere (Deno Deploy, Netlify/Vercel edge),
call `handleRequest(request, env)` from that host's entry point with the same three
env values.

## Security notes
- The client secret lives only in the worker's secret store — never in the browser
  bundle, never in git.
- The broker is stateless and holds no tokens; it relays one request and forgets.
- Origin allowlist + reflected CORS (never `*`) stop other sites from using it.
- Nothing is logged, so the secret and token never reach logs.
