export interface RepoConfig {
  owner: string;
  repo: string;
}

/**
 * The content repo this Timber instance edits (SPEC §3: single-tenant; a site is a
 * thin host page pinning config). Overridable via Vite env for dev; defaults to the
 * shared sandbox repo used by the github package's live tests.
 */
export const repoConfig: RepoConfig = {
  owner: (import.meta.env.VITE_TIMBER_OWNER as string | undefined) ?? 'TimAidley',
  repo: (import.meta.env.VITE_TIMBER_REPO as string | undefined) ?? 'Timber-test-sandbox',
};
