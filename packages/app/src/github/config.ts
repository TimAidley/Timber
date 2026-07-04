export interface RepoConfig {
  owner: string;
  repo: string;
  /**
   * Production OAuth (SPEC §9): set both to activate "Sign in with GitHub" (via the
   * `@timber/oauth-broker`). Unset ⇒ the dev paste-a-PAT gate. `clientId` is the OAuth
   * App's public client id; `brokerUrl` is the deployed token-exchange broker.
   */
  oauth: {
    clientId: string | undefined;
    brokerUrl: string | undefined;
  };
}

/**
 * The content repo this Timber instance edits (SPEC §3: single-tenant; a site is a
 * thin host page pinning config). Overridable via Vite env for dev; defaults to the
 * shared sandbox repo used by the github package's live tests.
 */
export const repoConfig: RepoConfig = {
  owner: (import.meta.env.VITE_TIMBER_OWNER as string | undefined) ?? 'TimAidley',
  repo: (import.meta.env.VITE_TIMBER_REPO as string | undefined) ?? 'Timber-test-sandbox',
  oauth: {
    clientId: import.meta.env.VITE_TIMBER_OAUTH_CLIENT_ID as string | undefined,
    brokerUrl: import.meta.env.VITE_TIMBER_OAUTH_BROKER_URL as string | undefined,
  },
};
