import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// OAuth mode requires a configured client id + broker URL; mock the config so the
// flow is exercised without Vite env.
vi.mock('../src/github/config.js', () => ({
  repoConfig: { owner: 'o', repo: 'r', oauth: { clientId: 'cid', brokerUrl: 'https://broker.test/token' } },
}));

import {
  pkceChallenge,
  completeLogin,
  isAuthenticated,
  signOut,
  getToken,
} from '../src/github/oauth.js';

beforeEach(() => {
  signOut();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => vi.unstubAllGlobals());

describe('PKCE (Web Crypto)', () => {
  it('produces the S256 challenge from the RFC 7636 test vector', async () => {
    // RFC 7636 Appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await pkceChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('completeLogin', () => {
  it('returns false and does nothing when there is no ?code', async () => {
    expect(await completeLogin()).toBe(false);
    expect(isAuthenticated()).toBe(false);
  });

  it('exchanges the code via the broker, stores the token, and cleans the URL', async () => {
    sessionStorage.setItem('timber.oauth.state', 'st8');
    sessionStorage.setItem('timber.oauth.verifier', 'ver1');
    window.history.replaceState({}, '', '/?code=abc&state=st8');
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ access_token: 'gho_x' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await completeLogin()).toBe(true);
    expect(isAuthenticated()).toBe(true);
    await expect(getToken()).resolves.toBe('gho_x');

    // The `?code` is stripped so a reload can't replay it.
    expect(window.location.search).toBe('');

    // The broker received the code + PKCE verifier.
    const init = fetchMock.mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ code: 'abc', code_verifier: 'ver1' });

    // PKCE verifier + state are consumed (one-shot).
    expect(sessionStorage.getItem('timber.oauth.verifier')).toBeNull();
    expect(sessionStorage.getItem('timber.oauth.state')).toBeNull();
  });

  it('rejects a state mismatch (CSRF guard) and stays unauthenticated', async () => {
    sessionStorage.setItem('timber.oauth.state', 'expected');
    sessionStorage.setItem('timber.oauth.verifier', 'ver1');
    window.history.replaceState({}, '', '/?code=abc&state=WRONG');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(completeLogin()).rejects.toThrow(/state mismatch/i);
    expect(isAuthenticated()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled(); // never calls the broker
  });

  it('surfaces a broker/GitHub error and stays unauthenticated', async () => {
    sessionStorage.setItem('timber.oauth.state', 'st8');
    sessionStorage.setItem('timber.oauth.verifier', 'ver1');
    window.history.replaceState({}, '', '/?code=stale&state=st8');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: 400 })),
    );

    await expect(completeLogin()).rejects.toThrow(/bad_verification_code/);
    expect(isAuthenticated()).toBe(false);
  });
});
