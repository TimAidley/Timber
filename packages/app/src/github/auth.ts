import type { GetToken } from '@timber/github';
import { repoConfig } from './config.js';
import { getToken as patGetToken } from './token.js';
import { getToken as oauthGetToken } from './oauth.js';
import { getToken as deviceGetToken } from './deviceFlow.js';

/**
 * Picks the auth mechanism behind the `getToken()` seam (SPEC §9). When a client id +
 * broker are configured it's a GitHub sign-in — either the **redirect** OAuth flow
 * (`oauth.ts`, default) or the **device** flow (`deviceFlow.ts`, `oauth.flow: 'device'`,
 * secret-less relay); otherwise the dev **paste-a-PAT** fallback (`token.ts`). All feed
 * `RepoClient` the same way — `repoSession.ts` imports `getToken` from here and never
 * learns which mode is active.
 */
export type AuthMode = 'oauth' | 'device' | 'pat';

const signInConfigured = Boolean(repoConfig.oauth.clientId && repoConfig.oauth.brokerUrl);

export const authMode: AuthMode = !signInConfigured
  ? 'pat'
  : repoConfig.oauth.flow === 'device'
    ? 'device'
    : 'oauth';

export const getToken: GetToken =
  authMode === 'device' ? deviceGetToken : authMode === 'oauth' ? oauthGetToken : patGetToken;
