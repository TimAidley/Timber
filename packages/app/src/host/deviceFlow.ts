import type { GetToken } from '@timber/host';
import { repoConfig } from './config.js';
import { hostDescriptor } from './hostDescriptor.js';

/**
 * GitHub **device flow** sign-in (SPEC §9), behind the same `getToken()` seam as the
 * redirect OAuth flow and the dev PAT. The device flow is a *public-client* flow — it
 * needs **no client secret** — so the broker here is a **secret-less relay** that only
 * exists to work around the fact that GitHub's device endpoints send no CORS headers
 * (a browser can't call them directly). The relay adds CORS; it holds nothing.
 *
 * Flow: ask the relay for a code → show the user a short `user_code` to enter at
 * `verification_uri` → poll the relay until the user approves → receive the token. The
 * token is kept in memory + `sessionStorage`, same posture as the redirect flow; no
 * refresh token is ever stored.
 */

const TOKEN_KEY = 'timber.device.token';

const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

// --- token store (in-memory, mirrored to sessionStorage) ---------------------

let inMemoryToken: string | null = null;

function storeToken(token: string): void {
  inMemoryToken = token;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // sessionStorage may be unavailable (private mode); in-memory still works.
  }
}

export function isAuthenticated(): boolean {
  if (inMemoryToken) return true;
  try {
    inMemoryToken = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    inMemoryToken = null;
  }
  return inMemoryToken !== null;
}

export function signOut(): void {
  inMemoryToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/** The `GetToken` implementation for device mode; rejects if not signed in. */
export const getToken: GetToken = async () => {
  if (isAuthenticated() && inMemoryToken) return inMemoryToken;
  throw new Error(`Not signed in — start the ${hostDescriptor.label} sign-in flow.`);
};

// --- relay + flow ------------------------------------------------------------

/** A relay endpoint URL: `${brokerUrl}/device/<name>` (broker trailing slash tolerated). */
function relayUrl(name: 'code' | 'token'): string {
  const { brokerUrl } = repoConfig.oauth;
  if (!brokerUrl) throw new Error('Sign-in is not configured (missing broker/relay URL).');
  return `${brokerUrl.replace(/\/+$/, '')}/device/${name}`;
}

export interface DeviceLogin {
  /** The short code the user types at `verificationUri` (e.g. `WDJB-MJHT`). */
  userCode: string;
  /** Where the user enters the code — `https://github.com/login/device`. */
  verificationUri: string;
  /** Same page with the code pre-filled, when GitHub provides it. */
  verificationUriComplete?: string;
  /** Opaque handle the app polls with (never shown to the user). */
  deviceCode: string;
  /** Seconds to wait between polls (GitHub's minimum). */
  interval: number;
  /** Seconds until the codes expire. */
  expiresIn: number;
}

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  interval?: number;
  expires_in?: number;
  error?: string;
}

/** Step 1: request a device + user code from the relay. */
export async function startDeviceLogin(): Promise<DeviceLogin> {
  const { clientId, scope } = repoConfig.oauth;
  if (!clientId) throw new Error('Sign-in is not configured (missing client id).');

  const response = await fetch(relayUrl('code'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, ...(scope ? { scope } : {}) }),
  });
  const data = (await response.json().catch(() => ({}))) as DeviceCodeResponse;
  if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error(`Sign-in failed: ${data.error ?? `device-code request returned ${response.status}`}.`);
  }
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    ...(data.verification_uri_complete ? { verificationUriComplete: data.verification_uri_complete } : {}),
    deviceCode: data.device_code,
    interval: typeof data.interval === 'number' && data.interval > 0 ? data.interval : 5,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 900,
  };
}

export type PollOutcome =
  | { status: 'authorized'; token: string }
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'error'; message: string };

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Interpret a device token-poll response (pure, so it's unit-testable). GitHub returns
 * `authorization_pending` until the user approves, `slow_down` if we polled too fast,
 * a terminal error (`expired_token`, `access_denied`), or the access token.
 */
export function interpretTokenResponse(data: TokenResponse): PollOutcome {
  if (typeof data.access_token === 'string' && data.access_token.length > 0) {
    return { status: 'authorized', token: data.access_token };
  }
  if (data.error === 'authorization_pending') return { status: 'pending' };
  if (data.error === 'slow_down') return { status: 'slow_down' };
  return { status: 'error', message: data.error_description ?? data.error ?? 'sign-in failed' };
}

/** One poll of the relay's token endpoint. */
export async function pollOnce(deviceCode: string): Promise<PollOutcome> {
  const { clientId } = repoConfig.oauth;
  const response = await fetch(relayUrl('token'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: DEVICE_CODE_GRANT }),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  return interpretTokenResponse(data);
}

const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('cancelled'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('cancelled'));
    });
  });

/**
 * Step 2: poll until the user approves (or the codes expire / are denied), respecting
 * GitHub's `interval` and `slow_down`. On success the token is stored and returned.
 */
export async function pollForToken(login: DeviceLogin, signal?: AbortSignal): Promise<string> {
  let intervalMs = login.interval * 1000;
  const deadline = Date.now() + login.expiresIn * 1000;

  for (;;) {
    await wait(intervalMs, signal);
    if (Date.now() > deadline) throw new Error('Sign-in timed out — please try again.');

    const outcome = await pollOnce(login.deviceCode);
    if (outcome.status === 'authorized') {
      storeToken(outcome.token);
      return outcome.token;
    }
    if (outcome.status === 'slow_down') {
      intervalMs += 5000; // GitHub asks us to back off by 5s
      continue;
    }
    if (outcome.status === 'pending') continue;
    throw new Error(`Sign-in failed: ${outcome.message}.`);
  }
}
