import type { GetToken } from '@timber/github';
import { repoConfig } from './config.js';
import { getToken as patGetToken } from './token.js';
import { getToken as oauthGetToken } from './oauth.js';

/**
 * Picks the auth mechanism behind the `getToken()` seam (SPEC §9). **OAuth** when the
 * OAuth env vars are configured (production sign-in via `oauth.ts` + the broker), else
 * the dev **paste-a-PAT** fallback (`token.ts`). Both feed `RepoClient` the same way —
 * `repoSession.ts` imports `getToken` from here and never learns which mode is active.
 */
export type AuthMode = 'oauth' | 'pat';

export const authMode: AuthMode =
  repoConfig.oauth.clientId && repoConfig.oauth.brokerUrl ? 'oauth' : 'pat';

export const getToken: GetToken = authMode === 'oauth' ? oauthGetToken : patGetToken;
