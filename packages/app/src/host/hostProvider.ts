import { RepoClient } from '@timber/github';
import { GiteaClient } from '@timber/gitea';
import { GitLabClient } from '@timber/gitlab';
import type { GetToken, HostProvider } from '@timber/host';
import type { HostKind } from './config.js';

/**
 * The single place the app constructs a concrete host adapter (SPEC's host-provider
 * seam). Everything else in the app depends only on the {@link HostProvider} port, so
 * choosing a host means changing this factory — not the editor, publish, autosave, or
 * deploy code. Three adapters exist: `@timber/github` (`RepoClient`), `@timber/gitea`
 * (`GiteaClient`, Gitea/Forgejo/Codeberg), and `@timber/gitlab` (`GitLabClient`).
 *
 * `HostTarget` is discriminated by `host` so each adapter gets exactly the construction
 * config it needs (GitHub: owner/repo; Gitea also needs the instance `apiBaseUrl`; GitLab
 * additionally takes a `projectPath` for nested groups).
 */
export type HostTarget =
  | { host: 'github'; owner: string; repo: string }
  | { host: 'gitea'; apiBaseUrl: string; owner: string; repo: string }
  | { host: 'gitlab'; apiBaseUrl: string; owner: string; repo: string; projectPath?: string };

export function createHostProvider(target: HostTarget, getToken: GetToken): HostProvider {
  if (target.host === 'gitea') {
    return new GiteaClient({
      apiBaseUrl: target.apiBaseUrl,
      owner: target.owner,
      repo: target.repo,
      getToken,
    });
  }
  if (target.host === 'gitlab') {
    return new GitLabClient({
      apiBaseUrl: target.apiBaseUrl,
      owner: target.owner,
      repo: target.repo,
      ...(target.projectPath ? { projectPath: target.projectPath } : {}),
      getToken,
    });
  }
  return new RepoClient({ owner: target.owner, repo: target.repo, getToken });
}

/**
 * Build a {@link HostTarget} from the resolved site config, validating the host-specific
 * requirements (Gitea/GitLab need an `apiBaseUrl`). Keeps the branching out of `repoSession`.
 */
export function hostTargetFromConfig(config: {
  host: HostKind;
  apiBaseUrl: string | undefined;
  projectPath: string | undefined;
  owner: string;
  repo: string;
}): HostTarget {
  if (config.host === 'gitea') {
    if (!config.apiBaseUrl) {
      throw new Error('Gitea host requires an apiBaseUrl (e.g. https://codeberg.org) in config');
    }
    return {
      host: 'gitea',
      apiBaseUrl: config.apiBaseUrl,
      owner: config.owner,
      repo: config.repo,
    };
  }
  if (config.host === 'gitlab') {
    if (!config.apiBaseUrl) {
      throw new Error('GitLab host requires an apiBaseUrl (e.g. https://gitlab.com) in config');
    }
    return {
      host: 'gitlab',
      apiBaseUrl: config.apiBaseUrl,
      owner: config.owner,
      repo: config.repo,
      ...(config.projectPath ? { projectPath: config.projectPath } : {}),
    };
  }
  return { host: 'github', owner: config.owner, repo: config.repo };
}
