import { repoConfig, type RepoConfig } from './config.js';

/**
 * The host-specific facts the auth UI + OAuth flow need, derived from the resolved
 * config (SPEC's host-provider seam). Keeps GitHub/Gitea specifics — the "Sign in with
 * X" label, where to create a token, the OAuth authorize endpoint — in one place instead
 * of hardcoded across the sign-in components, so a Codeberg/Gitea site presents its own
 * host rather than "GitHub" everywhere.
 *
 * Note: the OAuth **redirect** flow's token exchange still runs through
 * `@timber/oauth-broker`, which today calls GitHub's token endpoint — so full *Gitea*
 * OAuth is a broker follow-up (SPEC §16). A Gitea site signs in with a **PAT** today
 * (fully host-neutral here); `authorizeUrl` is generalized so the redirect flow is ready
 * the moment the broker is.
 */
export interface HostDescriptor {
  /** Human label for the host, e.g. `GitHub`, `Codeberg`, `Gitea`. */
  label: string;
  /** OAuth authorization endpoint for the redirect (PKCE) flow. */
  authorizeUrl: string;
  /** Where the user creates a personal access token (base URL; no query pre-fill assumed). */
  tokenSettingsUrl: string;
  /** Placeholder for the PAT input (the host's token prefix, if any). */
  patPlaceholder: string;
  /** Whether this host supports GitHub's query-param token pre-fill (GitHub only). */
  supportsTokenPrefill: boolean;
}

/** Codeberg is the best-known Gitea/Forgejo instance; label it by name, else generic Gitea. */
function giteaLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname === 'codeberg.org' ? 'Codeberg' : 'Gitea';
  } catch {
    return 'Gitea';
  }
}

export function hostDescriptorFor(config: RepoConfig): HostDescriptor {
  if (config.host === 'gitea') {
    const base = (config.apiBaseUrl ?? '').replace(/\/+$/, '');
    return {
      label: giteaLabel(base),
      // Gitea/Forgejo OAuth2 lives on the instance itself.
      authorizeUrl: `${base}/login/oauth/authorize`,
      // Gitea PATs are created under user settings → Applications.
      tokenSettingsUrl: `${base}/user/settings/applications`,
      patPlaceholder: 'access token…',
      supportsTokenPrefill: false,
    };
  }
  if (config.host === 'gitlab') {
    const base = (config.apiBaseUrl ?? '').replace(/\/+$/, '');
    return {
      // Codeberg-style specific label would need a host list; GitLab.com and self-hosted
      // both present as "GitLab".
      label: 'GitLab',
      // GitLab's OAuth2 authorize + token endpoints live at /oauth on the instance.
      authorizeUrl: `${base}/oauth/authorize`,
      // GitLab PATs: User settings → Access tokens.
      tokenSettingsUrl: `${base}/-/user_settings/personal_access_tokens`,
      patPlaceholder: 'glpat-…',
      supportsTokenPrefill: false,
    };
  }
  return {
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenSettingsUrl: 'https://github.com/settings/personal-access-tokens/new',
    patPlaceholder: 'github_pat_…',
    supportsTokenPrefill: true,
  };
}

/** The descriptor for this instance's configured host, resolved once at load. */
export const hostDescriptor: HostDescriptor = hostDescriptorFor(repoConfig);

/** localStorage key for the dev PAT — host-neutral (one editor deployment edits one host). */
export const PAT_STORAGE_KEY = 'timber.host.pat';
