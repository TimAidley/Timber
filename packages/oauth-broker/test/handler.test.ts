import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type BrokerEnv } from '../src/handler.js';

const env: BrokerEnv = {
  OAUTH_CLIENT_ID: 'client-123',
  OAUTH_CLIENT_SECRET: 'super-secret-value',
  ALLOWED_ORIGINS: 'https://you.github.io',
};

const FIRST_ORIGIN = 'https://you.github.io';

function post(body: unknown, origin: string | null = FIRST_ORIGIN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers['Origin'] = origin;
  return new Request('https://broker.example/', { method: 'POST', headers, body: JSON.stringify(body) });
}

afterEach(() => vi.unstubAllGlobals());

describe('oauth broker handler', () => {
  it('exchanges a code for a token and reflects CORS to the allowed origin', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'gho_abc', token_type: 'bearer', scope: 'repo' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleRequest(post({ code: 'the-code', code_verifier: 'v', redirect_uri: 'https://you.github.io/' }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(FIRST_ORIGIN);
    expect(await res.json()).toEqual({ access_token: 'gho_abc', token_type: 'bearer', scope: 'repo' });

    // The secret is added to GitHub's request but comes from env, never the client.
    const sentBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sentBody).toMatchObject({
      client_id: 'client-123',
      client_secret: 'super-secret-value',
      code: 'the-code',
      code_verifier: 'v',
    });
  });

  it('never leaks the client secret in the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ access_token: 'gho_abc' }), { status: 200 })),
    );
    const res = await handleRequest(post({ code: 'c', code_verifier: 'v' }), env);
    const raw = await res.clone().text();
    expect(raw).not.toContain(env.OAUTH_CLIENT_SECRET);
    for (const [, value] of res.headers) expect(value).not.toContain(env.OAUTH_CLIENT_SECRET);
  });

  it('still reads the legacy GITHUB_CLIENT_ID/SECRET names', async () => {
    const legacyEnv: BrokerEnv = {
      GITHUB_CLIENT_ID: 'legacy-id',
      GITHUB_CLIENT_SECRET: 'legacy-secret',
      ALLOWED_ORIGINS: FIRST_ORIGIN,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'gho_abc' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleRequest(post({ code: 'c', code_verifier: 'v' }), legacyEnv);
    expect(res.status).toBe(200);
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sent).toMatchObject({ client_id: 'legacy-id', client_secret: 'legacy-secret' });
  });

  it('returns 500 broker_misconfigured when client id/secret are absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleRequest(post({ code: 'c', code_verifier: 'v' }), { ALLOWED_ORIGINS: FIRST_ORIGIN });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('broker_misconfigured');
    expect(fetchMock).not.toHaveBeenCalled(); // never calls GitHub without credentials
  });

  it('allows an origin that differs only in case, reflecting the browser origin', async () => {
    // ALLOWED_ORIGINS configured as `https://You.GitHub.io` (owner login case), browser
    // sends the lowercased `https://you.github.io` — must still be allowed, and the
    // reflected CORS header must byte-match what the browser sent.
    const mixedEnv: BrokerEnv = { ...env, ALLOWED_ORIGINS: 'https://You.GitHub.io' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'gho_abc' }), { status: 200 })));
    const res = await handleRequest(post({ code: 'c', code_verifier: 'v' }, 'https://you.github.io'), mixedEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://you.github.io');
  });

  it('serves multiple sites from one broker (comma-separated ALLOWED_ORIGINS)', async () => {
    const multiEnv: BrokerEnv = { ...env, ALLOWED_ORIGINS: 'https://a.github.io, https://b.example' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'gho_abc' }), { status: 200 })));

    const resA = await handleRequest(post({ code: 'c', code_verifier: 'v' }, 'https://a.github.io'), multiEnv);
    expect(resA.status).toBe(200);
    expect(resA.headers.get('access-control-allow-origin')).toBe('https://a.github.io');

    const resB = await handleRequest(post({ code: 'c', code_verifier: 'v' }, 'https://b.example'), multiEnv);
    expect(resB.status).toBe(200);
    expect(resB.headers.get('access-control-allow-origin')).toBe('https://b.example');

    const resC = await handleRequest(post({ code: 'c', code_verifier: 'v' }, 'https://c.evil'), multiEnv);
    expect(resC.status).toBe(403);
  });

  it('still honours the legacy single ALLOWED_ORIGIN var', async () => {
    const legacyEnv: BrokerEnv = {
      GITHUB_CLIENT_ID: 'client-123',
      GITHUB_CLIENT_SECRET: 'super-secret-value',
      ALLOWED_ORIGIN: 'https://legacy.github.io',
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'gho_abc' }), { status: 200 })));
    const res = await handleRequest(post({ code: 'c', code_verifier: 'v' }, 'https://legacy.github.io'), legacyEnv);
    expect(res.status).toBe(200);
  });

  it('rejects an exchange with no code_verifier (PKCE enforced)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleRequest(post({ code: 'c' }), env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_code_verifier');
    expect(fetchMock).not.toHaveBeenCalled(); // never even calls GitHub
  });

  // --- device flow (secret-less relay) ---

  function devicePost(path: string, body: unknown, origin: string | null = FIRST_ORIGIN): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (origin) headers['Origin'] = origin;
    return new Request(`https://broker.example${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  it('relays /device/code to GitHub without using the client secret', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ device_code: 'dc', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleRequest(devicePost('/device/code', { client_id: 'client-123', scope: '' }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(FIRST_ORIGIN);
    expect((await res.json()).user_code).toBe('WDJB-MJHT');

    // Forwarded to GitHub's device-code endpoint with only the client id — no secret.
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toBe('https://github.com/login/device/code');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toEqual({ client_id: 'client-123' });
    expect(sent).not.toHaveProperty('client_secret');
  });

  it('relays /device/token, passing through authorization_pending', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 200 })));
    const res = await handleRequest(devicePost('/device/token', { client_id: 'client-123', device_code: 'dc' }), env);
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe('authorization_pending');
  });

  it('relays /device/token, passing through the access token on success', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'gho_dev', token_type: 'bearer' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleRequest(devicePost('/device/token', { client_id: 'client-123', device_code: 'dc' }), env);
    expect(res.status).toBe(200);
    expect((await res.json()).access_token).toBe('gho_dev');

    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sent).toMatchObject({ client_id: 'client-123', device_code: 'dc', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    expect(sent).not.toHaveProperty('client_secret');
  });

  it('device relay still enforces the origin allowlist', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleRequest(devicePost('/device/code', { client_id: 'c' }, 'https://evil.example'), env);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('device relay works even with no client secret configured (public-client flow)', async () => {
    const noSecretEnv: BrokerEnv = { OAUTH_CLIENT_ID: 'client-123', ALLOWED_ORIGINS: FIRST_ORIGIN };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ device_code: 'dc', user_code: 'U', verification_uri: 'https://github.com/login/device' }), { status: 200 })));
    const res = await handleRequest(devicePost('/device/code', { client_id: 'client-123' }), noSecretEnv);
    expect(res.status).toBe(200);
  });

  it('rejects a disallowed origin with 403 and no CORS header', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleRequest(post({ code: 'c' }, 'https://evil.example'), env);
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled(); // never even calls GitHub
  });

  it('rejects a request with no Origin header (e.g. curl) with 403', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const res = await handleRequest(post({ code: 'c' }, null), env);
    expect(res.status).toBe(403);
  });

  it('returns 400 when the code is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleRequest(post({ code_verifier: 'v' }), env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_code');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes through a sanitized GitHub error (e.g. bad_verification_code)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: 200 })),
    );
    const res = await handleRequest(post({ code: 'stale', code_verifier: 'v' }), env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bad_verification_code');
  });

  it('handles the CORS preflight for the allowed origin', async () => {
    const res = await handleRequest(
      new Request('https://broker.example/', { method: 'OPTIONS', headers: { Origin: FIRST_ORIGIN } }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(FIRST_ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('rejects a preflight from a disallowed origin', async () => {
    const res = await handleRequest(
      new Request('https://broker.example/', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }),
      env,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('oauth broker handler — Gitea mode', () => {
  const giteaEnv: BrokerEnv = {
    OAUTH_CLIENT_ID: 'gitea-client',
    GITEA_BASE_URL: 'https://codeberg.org/',
    ALLOWED_ORIGINS: 'https://you.codeberg.page',
  };
  const ORIGIN = 'https://you.codeberg.page';

  function giteaPost(body: unknown): Request {
    return new Request('https://broker.example/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(body),
    });
  }

  it('exchanges at the instance as a public client (no secret) with form-encoded params', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ access_token: 'gitea_tok', token_type: 'bearer' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleRequest(
      giteaPost({ code: 'the-code', code_verifier: 'v', redirect_uri: 'https://you.codeberg.page/edit/' }),
      giteaEnv,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(await res.json()).toMatchObject({ access_token: 'gitea_tok' });

    // Targets the configured instance's token endpoint (trailing slash normalized).
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://codeberg.org/login/oauth/access_token');
    // Form-encoded, no client_secret (public client).
    expect((init as RequestInit).headers).toMatchObject({
      'content-type': 'application/x-www-form-urlencoded',
    });
    const sent = new URLSearchParams((init as RequestInit).body as string);
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('client_id')).toBe('gitea-client');
    expect(sent.get('code')).toBe('the-code');
    expect(sent.get('code_verifier')).toBe('v');
    expect(sent.get('client_secret')).toBeNull();
  });

  it('includes client_secret only when configured (confidential Gitea client)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 't' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await handleRequest(giteaPost({ code: 'c', code_verifier: 'v' }), {
      ...giteaEnv,
      OAUTH_CLIENT_SECRET: 'confidential',
    });
    const sent = new URLSearchParams((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sent.get('client_secret')).toBe('confidential');
  });

  it('still enforces PKCE and the origin allowlist', async () => {
    const noVerifier = await handleRequest(giteaPost({ code: 'c' }), giteaEnv);
    expect(noVerifier.status).toBe(400);
    expect(await noVerifier.json()).toMatchObject({ error: 'missing_code_verifier' });

    const badOrigin = new Request('https://broker.example/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ code: 'c', code_verifier: 'v' }),
    });
    expect((await handleRequest(badOrigin, giteaEnv)).status).toBe(403);
  });

  it('passes through a sanitized instance error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    );
    const res = await handleRequest(giteaPost({ code: 'stale', code_verifier: 'v' }), giteaEnv);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });
});
