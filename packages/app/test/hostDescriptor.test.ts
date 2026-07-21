import { describe, expect, it } from 'vitest';
import { hostDescriptorFor } from '../src/host/hostDescriptor.js';
import type { RepoConfig } from '../src/host/config.js';

function config(over: Partial<RepoConfig>): RepoConfig {
  return {
    host: 'github',
    apiBaseUrl: undefined,
    projectPath: undefined,
    owner: 'jane',
    repo: 'site',
    oauth: { clientId: undefined, brokerUrl: undefined, scope: 'repo', redirectUri: undefined, flow: undefined },
    ...over,
  };
}

describe('hostDescriptorFor', () => {
  it('describes GitHub (label, endpoints, token pre-fill)', () => {
    const d = hostDescriptorFor(config({ host: 'github' }));
    expect(d.label).toBe('GitHub');
    expect(d.authorizeUrl).toBe('https://github.com/login/oauth/authorize');
    expect(d.tokenSettingsUrl).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(d.supportsTokenPrefill).toBe(true);
    expect(d.patPlaceholder).toContain('github_pat');
  });

  it('labels codeberg.org as Codeberg and derives instance endpoints', () => {
    const d = hostDescriptorFor(config({ host: 'gitea', apiBaseUrl: 'https://codeberg.org' }));
    expect(d.label).toBe('Codeberg');
    expect(d.authorizeUrl).toBe('https://codeberg.org/login/oauth/authorize');
    expect(d.tokenSettingsUrl).toBe('https://codeberg.org/user/settings/applications');
    expect(d.supportsTokenPrefill).toBe(false);
  });

  it('labels a self-hosted Gitea instance generically and derives its endpoints', () => {
    const d = hostDescriptorFor(config({ host: 'gitea', apiBaseUrl: 'https://git.example.org/' }));
    expect(d.label).toBe('Gitea');
    // Trailing slash on the base is normalized away.
    expect(d.authorizeUrl).toBe('https://git.example.org/login/oauth/authorize');
    expect(d.tokenSettingsUrl).toBe('https://git.example.org/user/settings/applications');
  });

  it('describes GitLab (/oauth authorize + access-tokens settings)', () => {
    const d = hostDescriptorFor(config({ host: 'gitlab', apiBaseUrl: 'https://gitlab.com' }));
    expect(d.label).toBe('GitLab');
    expect(d.authorizeUrl).toBe('https://gitlab.com/oauth/authorize');
    expect(d.tokenSettingsUrl).toBe('https://gitlab.com/-/user_settings/personal_access_tokens');
    expect(d.supportsTokenPrefill).toBe(false);
  });
});
