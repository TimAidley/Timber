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
