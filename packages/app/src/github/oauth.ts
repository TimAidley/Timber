import type { GetToken } from '@timber/github';
import { repoConfig } from './config.js';

/**
 * Production sign-in: the GitHub OAuth **authorization-code flow with PKCE** (SPEC §9),
 * behind the same `getToken()` seam as the dev PAT. The browser can't complete OAuth
 * alone (GitHub requires the client secret at token exchange and its token endpoint has
 * no CORS), so the code→token step goes through `@timber/oauth-broker`; everything else
 * — generating the PKCE challenge, the redirect, validating `state`, storing the token —
 * happens here with **Web Crypto**, no dependencies.
 *
 * The access token is kept in memory and mirrored to `sessionStorage` (session-scoped,
 * not shared across tabs, cleared on close) — a deliberate step up from the dev PAT's
 * `localStorage`, per SPEC §9's memory-over-localStorage posture. A **refresh token is
 * never persisted** (or even requested for storage): with GitHub App expiring tokens,
 * on expiry the user re-runs the flow (usually a single silent redirect). Broker-side
 * token custody behind an HttpOnly cookie — so the token never touches JS — is the
 * deferred Phase B (SPEC §16).
 */

const VERIFIER_KEY = 'timber.oauth.verifier';
const STATE_KEY = 'timber.oauth.state';
const TOKEN_KEY = 'timber.oauth.token';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

/** The redirect target GitHub returns to — the app parses `?code` itself. Pinned to
 * the configured value (must match the App's registered callback) so the `?code` can
 * only be delivered to the intended path; falls back to the app's own current URL when
 * unset (dev). */
function redirectUri(): string {
  return repoConfig.oauth.redirectUri ?? window.location.origin + window.location.pathname;
}

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

function readToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    inMemoryToken = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    inMemoryToken = null;
  }
  return inMemoryToken;
}

export function isAuthenticated(): boolean {
  return readToken() !== null;
}

export function signOut(): void {
  inMemoryToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/** The `GetToken` implementation for OAuth mode; rejects if not signed in. */
export const getToken: GetToken = async () => {
  const token = readToken();
  if (!token) throw new Error('Not signed in — start the GitHub sign-in flow.');
  return token;
};

// --- PKCE helpers (Web Crypto) ----------------------------------------------

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** The S256 PKCE challenge for a verifier: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

// --- the flow ----------------------------------------------------------------

/** Step 1: redirect to GitHub's authorize page with a fresh PKCE challenge + state. */
export async function beginLogin(): Promise<void> {
  const { clientId } = repoConfig.oauth;
  if (!clientId) throw new Error('OAuth is not configured (missing client id).');

  const verifier = randomToken(32);
  const state = randomToken(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  // A GitHub App ignores `scope` (permissions come from the App); OAuth Apps need it.
  // Config sets scope to '' in App mode, so we only send the param when non-empty.
  if (repoConfig.oauth.scope) url.searchParams.set('scope', repoConfig.oauth.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', await pkceChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(url.toString());
}

/**
 * Step 2: if this load is the OAuth redirect back (`?code&state`), validate `state`,
 * exchange the code for a token via the broker, and store it. Returns `true` when it
 * handled a callback (caller should proceed to load the session), `false` otherwise.
 * The `?code` is stripped from the URL either way so a reload can't replay it.
 */
export async function completeLogin(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  if (!code) return false;

  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  cleanUrl();
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);

  if (!returnedState || returnedState !== expectedState) {
    throw new Error('Sign-in failed: state mismatch (possible CSRF). Please try again.');
  }
  if (!verifier) {
    throw new Error('Sign-in failed: missing PKCE verifier. Please try again.');
  }

  const { brokerUrl } = repoConfig.oauth;
  if (!brokerUrl) throw new Error('OAuth is not configured (missing broker URL).');

  const response = await fetch(brokerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri() }),
  });
  // We read only `access_token` — any `refresh_token` in the response is deliberately
  // not captured, so no long-lived credential is ever stored in the browser.
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(`Sign-in failed: ${data.error ?? `token exchange returned ${response.status}`}.`);
  }

  storeToken(data.access_token);
  return true;
}

/** Strip the OAuth query params without a reload. */
function cleanUrl(): void {
  window.history.replaceState({}, '', window.location.origin + window.location.pathname);
}
