import { RepoClient } from '@timber/github';
import { GiteaClient } from '@timber/gitea';
import type { GetToken, HostProvider } from '@timber/host';
import type { HostKind } from './config.js';

/**
 * The single place the app constructs a concrete host adapter (SPEC's host-provider
 * seam). Everything else in the app depends only on the {@link HostProvider} port, so
 * choosing a host means changing this factory — not the editor, publish, autosave, or
 * deploy code. Two adapters exist today: `@timber/github` (`RepoClient`) and
 * `@timber/gitea` (`GiteaClient`, for Gitea/Forgejo/Codeberg).
 *
 * `HostTarget` is discriminated by `host` so each adapter gets exactly the construction
 * config it needs (GitHub: owner/repo; Gitea also needs the instance `apiBaseUrl`).
 */
export type HostTarget =
  | { host: 'github'; owner: string; repo: string }
  | { host: 'gitea'; apiBaseUrl: string; owner: string; repo: string };

export function createHostProvider(target: HostTarget, getToken: GetToken): HostProvider {
  if (target.host === 'gitea') {
    return new GiteaClient({
      apiBaseUrl: target.apiBaseUrl,
      owner: target.owner,
      repo: target.repo,
      getToken,
    });
  }
  return new RepoClient({ owner: target.owner, repo: target.repo, getToken });
}

/**
 * Build a {@link HostTarget} from the resolved site config, validating the host-specific
 * requirements (Gitea needs an `apiBaseUrl`). Keeps the branching out of `repoSession`.
 */
export function hostTargetFromConfig(config: {
  host: HostKind;
  apiBaseUrl: string | undefined;
  owner: string;
  repo: string;
}): HostTarget {
  if (config.host === 'gitea') {
    if (!config.apiBaseUrl) {
      throw new Error(
        'Gitea host requires an apiBaseUrl (e.g. https://codeberg.org) in config',
      );
    }
    return {
      host: 'gitea',
      apiBaseUrl: config.apiBaseUrl,
      owner: config.owner,
      repo: config.repo,
    };
  }
  return { host: 'github', owner: config.owner, repo: config.repo };
}
