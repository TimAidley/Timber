import { RepoClient } from '@timber/github';
import type { GetToken, HostProvider } from '@timber/host';

/**
 * The single place the app constructs a concrete host adapter (SPEC's host-provider
 * seam). Everything else in the app depends only on the {@link HostProvider} port, so
 * swapping in a GitLab/Gitea/self-hosted adapter later means changing this factory —
 * not the editor, publish, autosave, or deploy code.
 *
 * Today there is one adapter (`@timber/github`'s `RepoClient`); a `host` discriminator
 * on the site config selects it. Both the site repo (`repoSession`) and the upstream
 * Timber repo used for the out-of-date check (`Editor`) are built through here.
 */
export interface HostTarget {
  owner: string;
  repo: string;
}

export function createHostProvider(target: HostTarget, getToken: GetToken): HostProvider {
  return new RepoClient({ owner: target.owner, repo: target.repo, getToken });
}
