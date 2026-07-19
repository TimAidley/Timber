/**
 * The OAuth token-exchange broker (SPEC §9). GitHub's user-token exchange requires
 * the `client_secret` even under PKCE, and the token endpoint sends no CORS headers —
 * so a purely static SPA cannot complete OAuth alone. This tiny, stateless handler is
 * the minimum server-side piece: it receives the `code` from the app, adds the secret
 * (which lives only here, never in the browser bundle), POSTs to GitHub, and returns
 * the token. It holds no state, no sessions, no database.
 *
 * It also serves the **device flow** as a *secret-less relay*: `POST /device/code` and
 * `POST /device/token` just forward to GitHub's device endpoints (which also send no
 * CORS) and add CORS. The device flow is a public-client flow, so **no client secret is
 * used** on that path — a broker can serve device sign-in with the secret unset.
 *
 * Security posture:
 * - **Origin allowlist** (`ALLOWED_ORIGINS`): a browser will only send requests from
 *   an allow-listed site, and CORS is reflected to that origin only (never `*`), so
 *   other *websites* can't drive this broker from a victim's browser (anti-CSRF /
 *   anti-quota-abuse). Note this is NOT an authentication boundary: a non-browser
 *   client (curl) can spoof the `Origin` header. The real protection against a stolen
 *   `code` is the client secret + PKCE `code_verifier` (required below) + GitHub's
 *   short code TTL. Treat the allowlist as hardening, not access control.
 * - PKCE is **enforced**: an exchange without a `code_verifier` is rejected, so PKCE
 *   is a genuine end-to-end guarantee rather than an optional extra.
 * - The secret is never logged, echoed, or included in any response.
 *
 * Multiple sites can share one broker: `ALLOWED_ORIGINS` is a comma/space-separated
 * list, so one App + one broker can serve several content-repo deployments.
 *
 * **Gitea/Forgejo (Codeberg) mode:** set `GITEA_BASE_URL` (e.g. `https://codeberg.org`)
 * and the authorization-code exchange targets that instance instead of GitHub. Gitea
 * supports **public OAuth clients** (PKCE, no secret), so the broker here is a *secret-less
 * relay* — it exists only because Gitea's token endpoint sends no CORS (confirmed against
 * Codeberg), not because a secret must be hidden. Provide `OAUTH_CLIENT_SECRET` too only if
 * you registered a *confidential* Gitea client; it's optional. (One broker deployment
 * serves one provider — GitHub when `GITEA_BASE_URL` is unset, Gitea when it's set.)
 */
export interface BrokerEnv {
  /**
   * When set (e.g. `https://codeberg.org`), the broker runs in **Gitea mode**: the
   * authorization-code exchange POSTs to `<base>/login/oauth/access_token` as a public
   * client (no secret required). Unset ⇒ GitHub mode (the default).
   */
  GITEA_BASE_URL?: string;
  /**
   * The GitHub/OAuth App's client id (public — safe to expose). Named without a
   * `GITHUB_` prefix on purpose: GitHub Actions **reserves** that prefix, so a
   * `GITHUB_`-named secret/variable/env can't be created in a workflow — which is how
   * the broker is normally deployed. The legacy `GITHUB_CLIENT_ID` is still read.
   */
  OAUTH_CLIENT_ID?: string;
  /** The App's client secret (set as a secret; NEVER committed). See `OAUTH_CLIENT_ID`. */
  OAUTH_CLIENT_SECRET?: string;
  /** @deprecated Reserved-prefix name, still honoured. Prefer `OAUTH_CLIENT_ID`. */
  GITHUB_CLIENT_ID?: string;
  /** @deprecated Reserved-prefix name, still honoured. Prefer `OAUTH_CLIENT_SECRET`. */
  GITHUB_CLIENT_SECRET?: string;
  /**
   * Origins allowed to call this broker — comma/space-separated for multi-site use,
   * e.g. `https://you.github.io, https://blog.example`. Each is an exact origin
   * (scheme + host, no path, no trailing slash).
   */
  ALLOWED_ORIGINS?: string;
  /** @deprecated Single-origin form, still honoured. Prefer `ALLOWED_ORIGINS`. */
  ALLOWED_ORIGIN?: string;
}

interface ExchangeRequest {
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
}

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/**
 * The set of allow-listed origins (lowercased), from `ALLOWED_ORIGINS` (preferred)
 * merged with the legacy single `ALLOWED_ORIGIN`. Lowercased because a browser's
 * Origin lowercases the host (GitHub Pages serves `https://<owner>.github.io` in
 * lowercase) while the config may carry the owner's original-case login.
 */
function allowedOrigins(env: BrokerEnv): Set<string> {
  const raw = `${env.ALLOWED_ORIGINS ?? ''},${env.ALLOWED_ORIGIN ?? ''}`;
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((o) => o.trim().toLowerCase())
      .filter((o) => o.length > 0),
  );
}

export async function handleRequest(request: Request, env: BrokerEnv): Promise<Response> {
  const origin = request.headers.get('Origin');
  // We still reflect the request's *actual* origin in the CORS header (it must
  // byte-match what the browser sent), but decide allow/deny case-insensitively.
  const allowed = origin !== null && allowedOrigins(env).has(origin.toLowerCase());

  // CORS preflight: only greenlight the allowlisted origin.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: allowed ? 204 : 403, headers: cors(allowed ? origin : null) });
  }

  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, null);
  }
  if (!allowed) {
    return json({ error: 'origin_not_allowed' }, 403, null);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }

  // Device flow (SPEC §9): the broker is a **secret-less relay** for GitHub's device
  // endpoints (they send no CORS, so the browser can't call them directly). No client
  // secret is used — that's the whole point of the device flow.
  const path = new URL(request.url).pathname;
  if (path.endsWith('/device/code')) return relayDeviceCode(body, origin);
  if (path.endsWith('/device/token')) return relayDeviceToken(body, origin);

  // Otherwise: the authorization-code exchange (needs the client secret).
  return exchangeCode(body as ExchangeRequest, env, origin);
}

/** The authorization-code → token exchange (redirect/PKCE flow; uses the client secret). */
async function exchangeCode(
  body: ExchangeRequest,
  env: BrokerEnv,
  origin: string | null,
): Promise<Response> {
  if (!body.code) {
    return json({ error: 'missing_code' }, 400, origin);
  }
  // Enforce PKCE end-to-end: without the verifier, a stolen `code` alone must not be
  // redeemable here. (The app always sends it; a request lacking it is not our client.)
  if (!body.code_verifier) {
    return json({ error: 'missing_code_verifier' }, 400, origin);
  }

  // Gitea/Forgejo mode: exchange at the configured instance as a public client (no secret).
  if (env.GITEA_BASE_URL) {
    return exchangeGitea(body, env, origin);
  }

  // Prefer the prefix-free names; fall back to the legacy `GITHUB_*` for brokers that
  // were configured before the rename.
  const clientId = env.OAUTH_CLIENT_ID ?? env.GITHUB_CLIENT_ID;
  const clientSecret = env.OAUTH_CLIENT_SECRET ?? env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return json({ error: 'broker_misconfigured' }, 500, origin);
  }

  const githubResponse = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: body.code,
      code_verifier: body.code_verifier,
      ...(body.redirect_uri ? { redirect_uri: body.redirect_uri } : {}),
    }),
  });

  const data = (await githubResponse.json().catch(() => ({}))) as Record<string, unknown>;

  if (!githubResponse.ok || typeof data.access_token !== 'string') {
    // Pass through a sanitized error only — never the secret or GitHub internals.
    const error = typeof data.error === 'string' ? data.error : 'exchange_failed';
    return json({ error }, 400, origin);
  }

  return json(
    { access_token: data.access_token, token_type: data.token_type, scope: data.scope },
    200,
    origin,
  );
}

/**
 * Gitea/Forgejo authorization-code exchange. Gitea supports **public clients** (PKCE, no
 * secret), so this sends `client_secret` only if one is configured (a confidential client).
 * The token endpoint takes standard form-encoded params; we ask for JSON back. Errors are
 * passed through sanitized, never the instance internals.
 */
async function exchangeGitea(
  body: ExchangeRequest,
  env: BrokerEnv,
  origin: string | null,
): Promise<Response> {
  const clientId = env.OAUTH_CLIENT_ID ?? env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return json({ error: 'broker_misconfigured' }, 500, origin);
  }
  const clientSecret = env.OAUTH_CLIENT_SECRET ?? env.GITHUB_CLIENT_SECRET;
  const base = env.GITEA_BASE_URL!.replace(/\/+$/, '');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: body.code!,
    code_verifier: body.code_verifier!,
    ...(body.redirect_uri ? { redirect_uri: body.redirect_uri } : {}),
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  });

  const giteaResponse = await fetch(`${base}/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: params.toString(),
  });

  const data = (await giteaResponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!giteaResponse.ok || typeof data.access_token !== 'string') {
    const error = typeof data.error === 'string' ? data.error : 'exchange_failed';
    return json({ error }, 400, origin);
  }

  return json(
    { access_token: data.access_token, token_type: data.token_type, scope: data.scope },
    200,
    origin,
  );
}

/** Relay `POST /login/device/code` (no secret). Returns GitHub's JSON verbatim — it holds
 * only the device/user codes + verification URL, nothing sensitive. */
async function relayDeviceCode(body: Record<string, unknown>, origin: string | null): Promise<Response> {
  const clientId = typeof body.client_id === 'string' ? body.client_id : undefined;
  if (!clientId) return json({ error: 'missing_client_id' }, 400, origin);

  const gh = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      ...(typeof body.scope === 'string' && body.scope ? { scope: body.scope } : {}),
    }),
  });
  const data = (await gh.json().catch(() => ({}))) as Record<string, unknown>;
  return json(data, typeof data.device_code === 'string' ? 200 : 400, origin);
}

/** Relay `POST /login/oauth/access_token` for the device grant (no secret). Passed through
 * verbatim so the app sees `authorization_pending` / `slow_down` / the access token. */
async function relayDeviceToken(body: Record<string, unknown>, origin: string | null): Promise<Response> {
  const clientId = typeof body.client_id === 'string' ? body.client_id : undefined;
  const deviceCode = typeof body.device_code === 'string' ? body.device_code : undefined;
  if (!clientId || !deviceCode) return json({ error: 'missing_params' }, 400, origin);

  const gh = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: DEVICE_CODE_GRANT }),
  });
  const data = (await gh.json().catch(() => ({}))) as Record<string, unknown>;
  return json(data, 200, origin);
}

/** CORS headers, reflecting the allowed origin only (never `*`). */
function cors(allowedOrigin: string | null): Record<string, string> {
  if (!allowedOrigin) return {};
  return {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function json(payload: unknown, status: number, allowedOrigin: string | null): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...cors(allowedOrigin) },
  });
}
