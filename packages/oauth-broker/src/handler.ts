/**
 * The OAuth token-exchange broker (SPEC §9). GitHub's user-token exchange requires
 * the `client_secret` even under PKCE, and the token endpoint sends no CORS headers —
 * so a purely static SPA cannot complete OAuth alone. This tiny, stateless handler is
 * the minimum server-side piece: it receives the `code` from the app, adds the secret
 * (which lives only here, never in the browser bundle), POSTs to GitHub, and returns
 * the token. It holds no state, no sessions, no database.
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
 */
export interface BrokerEnv {
  /** The GitHub/OAuth App's client id (public — safe to expose). */
  GITHUB_CLIENT_ID: string;
  /** The App's client secret (set via `wrangler secret put`; NEVER committed). */
  GITHUB_CLIENT_SECRET: string;
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

  let body: ExchangeRequest;
  try {
    body = (await request.json()) as ExchangeRequest;
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }
  if (!body.code) {
    return json({ error: 'missing_code' }, 400, origin);
  }
  // Enforce PKCE end-to-end: without the verifier, a stolen `code` alone must not be
  // redeemable here. (The app always sends it; a request lacking it is not our client.)
  if (!body.code_verifier) {
    return json({ error: 'missing_code_verifier' }, 400, origin);
  }

  const githubResponse = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
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
