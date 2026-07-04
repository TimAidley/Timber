import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type BrokerEnv } from '../src/handler.js';

const env: BrokerEnv = {
  GITHUB_CLIENT_ID: 'client-123',
  GITHUB_CLIENT_SECRET: 'super-secret-value',
  ALLOWED_ORIGIN: 'https://you.github.io',
};

function post(body: unknown, origin: string | null = env.ALLOWED_ORIGIN): Request {
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
    expect(res.headers.get('access-control-allow-origin')).toBe(env.ALLOWED_ORIGIN);
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
    const res = await handleRequest(post({ code: 'c' }), env);
    const raw = await res.clone().text();
    expect(raw).not.toContain(env.GITHUB_CLIENT_SECRET);
    for (const [, value] of res.headers) expect(value).not.toContain(env.GITHUB_CLIENT_SECRET);
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
    const res = await handleRequest(post({ code: 'stale' }), env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bad_verification_code');
  });

  it('handles the CORS preflight for the allowed origin', async () => {
    const res = await handleRequest(
      new Request('https://broker.example/', { method: 'OPTIONS', headers: { Origin: env.ALLOWED_ORIGIN } }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(env.ALLOWED_ORIGIN);
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
