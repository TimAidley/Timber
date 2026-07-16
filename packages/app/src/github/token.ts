import type { GetToken } from '@timber/host';

/**
 * The browser implementation of the `getToken()` seam (SPEC §9). For dev, the user
 * pastes a fine-grained PAT; this is the mechanism, deliberately behind the seam so
 * the eventual end-user flow (OAuth broker / GitHub App PKCE — SPEC §16, deferred)
 * drops in here without touching any commit/publish code.
 *
 * The PAT is kept in `localStorage` — a conscious **dev-only** deviation from SPEC
 * §9's "avoid localStorage" production posture (the target is a throwaway test repo,
 * so not re-pasting on reload wins). Tightening this later (in-memory / broker)
 * touches only this file.
 */
const STORAGE_KEY = 'timber.github.pat';

export function getStoredToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token.trim());
}

export function clearStoredToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** A `GetToken` that reads the pasted PAT; rejects clearly if none is set. */
export const getToken: GetToken = async () => {
  const token = getStoredToken();
  if (!token) throw new Error('No GitHub token set — paste a personal access token to continue.');
  return token;
};
