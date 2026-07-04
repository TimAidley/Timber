/**
 * The OAuth token-exchange broker (SPEC §9). GitHub's user-token exchange requires
 * the `client_secret` even under PKCE, and the token endpoint sends no CORS headers —
 * so a purely static SPA cannot complete OAuth alone. This tiny, stateless handler is
 * the minimum server-side piece: it receives the `code` from the app, adds the secret
 * (which lives only here, never in the browser bundle), POSTs to GitHub, and returns
 * the token. It holds no state, no sessions, no database.
 *
 * Security posture:
 * - **Origin allowlist** (`ALLOWED_ORIGIN`): only the configured site may use this
 *   broker; every other origin is rejected, so a leaked broker URL can't be abused.
 * - CORS is reflected to the allowed origin only (never `*`).
 * - The secret is never logged, echoed, or included in any response.
 */
export interface BrokerEnv {
  /** The OAuth App's client id (public — safe to expose). */
  GITHUB_CLIENT_ID: string;
  /** The OAuth App's client secret (set via `wrangler secret put`; NEVER committed). */
  GITHUB_CLIENT_SECRET: string;
  /** Exact origin allowed to call this broker, e.g. `https://you.github.io`. */
  ALLOWED_ORIGIN: string;
}

interface ExchangeRequest {
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
}

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export async function handleRequest(request: Request, env: BrokerEnv): Promise<Response> {
  const origin = request.headers.get('Origin');
  const allowed = origin !== null && origin === env.ALLOWED_ORIGIN;

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

  const githubResponse = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: body.code,
      ...(body.code_verifier ? { code_verifier: body.code_verifier } : {}),
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
