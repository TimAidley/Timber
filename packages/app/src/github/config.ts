/** Which git host adapter backs this instance (SPEC's host-provider seam). */
export type HostKind = 'github' | 'gitea';

export interface RepoConfig {
  /**
   * The git host to edit against: `github` (default) or `gitea` (Gitea/Forgejo, e.g.
   * Codeberg). Selects the {@link HostProvider} adapter in `createHostProvider`.
   */
  host: HostKind;
  /**
   * For `gitea`: the instance origin, e.g. `https://codeberg.org` (the `/api/v1` root is
   * appended by the adapter). Unused by `github`.
   */
  apiBaseUrl: string | undefined;
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
     * OAuth `scope` to request. Classic **OAuth Apps** need `repo` (the default when
     * unset) to write a private repo's contents. A **GitHub App** ignores `scope` —
     * its permissions come from the App registration — so set this to `''` in App
     * mode to omit the param.
     */
    scope: string | undefined;
    /**
     * Exact OAuth callback to use, matching the App's registered callback. When unset
     * it falls back to the app's own current URL (origin + pathname) — which is where
     * the editor is served, i.e. the callback anyway. Set it only to override.
     */
    redirectUri: string | undefined;
    /**
     * Which sign-in flow to use when `clientId` + `brokerUrl` are set: `'redirect'`
     * (default) is the authorization-code + PKCE flow; `'device'` is the device flow —
     * no client secret, so the broker acts as a secret-less relay (SPEC §9). Anything
     * else falls back to `'redirect'`.
     */
    flow: string | undefined;
  };
}

/**
 * The **runtime** config shape a site provides via a `config.js` that sets
 * `window.__TIMBER_CONFIG__` before the app bundle runs (see `public/config.js`). This
 * is the distribution model SPEC §2 calls for — a **thin host page pinning config**, so
 * the built app is a version-pinned artifact and a site is just its own `config.js`, no
 * per-site rebuild. Every field is optional; anything omitted falls back to a `VITE_*`
 * build var (legacy / dev) and then a default.
 */
export interface RuntimeConfig {
  host?: string;
  apiBaseUrl?: string;
  owner?: string;
  repo?: string;
  oauth?: {
    clientId?: string;
    brokerUrl?: string;
    scope?: string;
    redirectUri?: string;
    flow?: string;
  };
}

/** A subset of `import.meta.env` — just the keys we read (kept loose for testing). */
type EnvLike = Record<string, string | undefined>;

/** A non-empty string, else undefined — so a blank runtime field or CI var falls back. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Resolve the effective config from the runtime global (highest priority) over the
 * `VITE_*` build vars, then defaults. Pure + injectable so it's unit-testable without
 * module-load gymnastics.
 */
export function resolveConfig(runtime: RuntimeConfig, env: EnvLike): RepoConfig {
  // Only `gitea` opts out of the GitHub default; anything else resolves to `github`.
  const rawHost = str(runtime.host) ?? str(env.VITE_TIMBER_HOST);
  return {
    host: rawHost === 'gitea' ? 'gitea' : 'github',
    apiBaseUrl: str(runtime.apiBaseUrl) ?? str(env.VITE_TIMBER_API_BASE_URL),
    owner: str(runtime.owner) ?? str(env.VITE_TIMBER_OWNER) ?? 'TimAidley',
    repo: str(runtime.repo) ?? str(env.VITE_TIMBER_REPO) ?? 'Timber-test-sandbox',
    oauth: {
      clientId: str(runtime.oauth?.clientId) ?? str(env.VITE_TIMBER_OAUTH_CLIENT_ID),
      brokerUrl: str(runtime.oauth?.brokerUrl) ?? str(env.VITE_TIMBER_OAUTH_BROKER_URL),
      // `scope` differs: an EMPTY string is a meaningful value (GitHub App mode), so
      // preserve it with `??` and only fall back to `repo` when it is truly absent.
      scope: runtime.oauth?.scope ?? env.VITE_TIMBER_OAUTH_SCOPE ?? 'repo',
      redirectUri:
        str(runtime.oauth?.redirectUri) ?? str(env.VITE_TIMBER_OAUTH_REDIRECT_URI),
      flow: str(runtime.oauth?.flow) ?? str(env.VITE_TIMBER_OAUTH_FLOW),
    },
  };
}

/** Read the site-provided runtime config, if any (browser only). */
function runtimeConfig(): RuntimeConfig {
  if (typeof window === 'undefined') return {};
  return (
    (window as unknown as { __TIMBER_CONFIG__?: RuntimeConfig }).__TIMBER_CONFIG__ ?? {}
  );
}

/**
 * The content repo this Timber instance edits (SPEC §3: single-tenant). Resolved once
 * at load: a site's `config.js` (`window.__TIMBER_CONFIG__`) wins, else `VITE_*` build
 * vars, else the shared sandbox defaults.
 */
export const repoConfig: RepoConfig = resolveConfig(
  runtimeConfig(),
  import.meta.env as unknown as EnvLike,
);
