import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Device flow needs a client id + broker (relay) URL; mock the config.
vi.mock('../src/host/config.js', () => ({
  repoConfig: {
    owner: 'o',
    repo: 'r',
    oauth: { clientId: 'cid', brokerUrl: 'https://broker.test', scope: '' },
  },
}));

import {
  interpretTokenResponse,
  startDeviceLogin,
  pollOnce,
  isAuthenticated,
  signOut,
  getToken,
} from '../src/host/deviceFlow.js';

beforeEach(() => {
  signOut();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('interpretTokenResponse', () => {
  it('recognises an access token', () => {
    expect(interpretTokenResponse({ access_token: 'gho_x' })).toEqual({ status: 'authorized', token: 'gho_x' });
  });
  it('recognises authorization_pending and slow_down', () => {
    expect(interpretTokenResponse({ error: 'authorization_pending' })).toEqual({ status: 'pending' });
    expect(interpretTokenResponse({ error: 'slow_down' })).toEqual({ status: 'slow_down' });
  });
  it('treats other errors as terminal, preferring the description', () => {
    expect(interpretTokenResponse({ error: 'expired_token', error_description: 'The code expired' })).toEqual({
      status: 'error',
      message: 'The code expired',
    });
    expect(interpretTokenResponse({ error: 'access_denied' })).toEqual({ status: 'error', message: 'access_denied' });
  });
});

describe('startDeviceLogin', () => {
  it('requests a device code from the relay and maps the response', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            device_code: 'dc',
            user_code: 'WDJB-MJHT',
            verification_uri: 'https://github.com/login/device',
            verification_uri_complete: 'https://github.com/login/device?user_code=WDJB-MJHT',
            interval: 5,
            expires_in: 900,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const login = await startDeviceLogin();
    expect(login).toMatchObject({
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      verificationUriComplete: 'https://github.com/login/device?user_code=WDJB-MJHT',
      deviceCode: 'dc',
      interval: 5,
      expiresIn: 900,
    });

    // Posted to the relay's /device/code with the client id, no secret.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://broker.test/device/code');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ client_id: 'cid' });
  });

  it('throws when the relay returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'device_flow_disabled' }), { status: 400 })));
    await expect(startDeviceLogin()).rejects.toThrow(/device_flow_disabled/);
  });
});

describe('pollOnce', () => {
  it('posts the device grant and interprets the response', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ access_token: 'gho_x' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await pollOnce('dc');
    expect(outcome).toEqual({ status: 'authorized', token: 'gho_x' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://broker.test/device/token');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      client_id: 'cid',
      device_code: 'dc',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
  });
});

describe('token store', () => {
  it('is unauthenticated until getToken has a token, and signs out', async () => {
    expect(isAuthenticated()).toBe(false);
    await expect(getToken()).rejects.toThrow(/Not signed in/);
    sessionStorage.setItem('timber.device.token', 'gho_stored');
    expect(isAuthenticated()).toBe(true);
    await expect(getToken()).resolves.toBe('gho_stored');
    signOut();
    expect(isAuthenticated()).toBe(false);
  });
});
