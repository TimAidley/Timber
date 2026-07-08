export interface RepoConfig {
  owner: string;
  repo: string;
  /**
   * Production sign-in (SPEC §9): set `clientId` + `brokerUrl` to activate "Sign in
   * with GitHub" (via the `@timber/oauth-broker`). Unset ⇒ the dev paste-a-PAT gate.
   * `clientId` is the GitHub/OAuth App's public client id; `brokerUrl` is the deployed
   * token-exchange broker.
   */
  oauth: {
    clientId: string | undefined;
    brokerUrl: string | undefined;
    /**
     * OAuth `scope` to request. Classic **OAuth Apps** need `repo` (the default) to
     * write a private repo's contents. A **GitHub App** ignores `scope` entirely —
     * its permissions come from the App registration — so set this to `''` in App
     * mode to omit the param.
     */
    scope: string | undefined;
    /**
     * Exact OAuth callback to use, matching the App's registered callback. When unset
     * it falls back to the app's own current URL (origin + pathname). Pin it in
     * production so the `?code` can only ever be delivered to the intended path
     * (avoids same-origin code delivery to another Pages project — SPEC §9).
     */
    redirectUri: string | undefined;
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
    // Defaults to `repo` (classic OAuth App). Set VITE_TIMBER_OAUTH_SCOPE='' for a
    // GitHub App, which ignores scope.
    scope: (import.meta.env.VITE_TIMBER_OAUTH_SCOPE as string | undefined) ?? 'repo',
    redirectUri: import.meta.env.VITE_TIMBER_OAUTH_REDIRECT_URI as string | undefined,
  },
};
