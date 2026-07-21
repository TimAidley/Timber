import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig, type RuntimeConfig } from '../src/host/config.js';

describe('resolveConfig', () => {
  it('uses defaults when neither runtime nor env is set', () => {
    const c = resolveConfig({}, {});
    expect(c.owner).toBe('TimAidley');
    expect(c.repo).toBe('Timber-test-sandbox');
    expect(c.oauth.clientId).toBeUndefined();
    expect(c.oauth.brokerUrl).toBeUndefined();
    expect(c.oauth.scope).toBe('repo'); // classic OAuth App default
  });

  it('reads VITE_* build vars when there is no runtime config', () => {
    const c = resolveConfig(
      {},
      {
        VITE_TIMBER_OWNER: 'envowner',
        VITE_TIMBER_REPO: 'envrepo',
        VITE_TIMBER_OAUTH_CLIENT_ID: 'env-cid',
        VITE_TIMBER_OAUTH_BROKER_URL: 'https://env.broker',
      },
    );
    expect(c.owner).toBe('envowner');
    expect(c.repo).toBe('envrepo');
    expect(c.oauth.clientId).toBe('env-cid');
    expect(c.oauth.brokerUrl).toBe('https://env.broker');
  });

  it('runtime config (config.js) wins over env and defaults', () => {
    const runtime: RuntimeConfig = {
      owner: 'rtowner',
      repo: 'rtrepo',
      oauth: { clientId: 'rt-cid', brokerUrl: 'https://rt.broker' },
    };
    const c = resolveConfig(runtime, {
      VITE_TIMBER_OWNER: 'envowner',
      VITE_TIMBER_OAUTH_CLIENT_ID: 'env-cid',
    });
    expect(c.owner).toBe('rtowner');
    expect(c.repo).toBe('rtrepo');
    expect(c.oauth.clientId).toBe('rt-cid');
    expect(c.oauth.brokerUrl).toBe('https://rt.broker');
  });

  it('defaults host to github with no apiBaseUrl', () => {
    const c = resolveConfig({}, {});
    expect(c.host).toBe('github');
    expect(c.apiBaseUrl).toBeUndefined();
  });

  it('selects the gitea host and apiBaseUrl (runtime and env)', () => {
    const rt = resolveConfig({ host: 'gitea', apiBaseUrl: 'https://codeberg.org' }, {});
    expect(rt.host).toBe('gitea');
    expect(rt.apiBaseUrl).toBe('https://codeberg.org');

    const env = resolveConfig(
      {},
      { VITE_TIMBER_HOST: 'gitea', VITE_TIMBER_API_BASE_URL: 'https://git.example.org' },
    );
    expect(env.host).toBe('gitea');
    expect(env.apiBaseUrl).toBe('https://git.example.org');
  });

  it('falls back to github for an unknown host value', () => {
    expect(resolveConfig({ host: 'bitbucket' }, {}).host).toBe('github');
  });

  it('selects the gitlab host with apiBaseUrl + projectPath', () => {
    const c = resolveConfig(
      { host: 'gitlab', apiBaseUrl: 'https://gitlab.com', projectPath: 'grp/sub/site' },
      {},
    );
    expect(c.host).toBe('gitlab');
    expect(c.apiBaseUrl).toBe('https://gitlab.com');
    expect(c.projectPath).toBe('grp/sub/site');
  });

  it('defaults the OAuth scope per host (repo for GitHub, empty for Gitea/GitLab)', () => {
    expect(resolveConfig({}, {}).oauth.scope).toBe('repo');
    expect(resolveConfig({ host: 'gitea', apiBaseUrl: 'https://codeberg.org' }, {}).oauth.scope).toBe('');
    expect(resolveConfig({ host: 'gitlab', apiBaseUrl: 'https://gitlab.com' }, {}).oauth.scope).toBe('');
    // An explicit scope still wins on any host.
    expect(resolveConfig({ host: 'gitea', oauth: { scope: 'write:repository' } }, {}).oauth.scope).toBe(
      'write:repository',
    );
  });

  it('preserves an EMPTY scope (GitHub App mode) instead of defaulting to repo', () => {
    const c = resolveConfig({ oauth: { scope: '' } }, {});
    expect(c.oauth.scope).toBe('');
  });

  it('treats blank runtime strings as absent and falls back', () => {
    const c = resolveConfig(
      { owner: '', oauth: { clientId: '' } },
      { VITE_TIMBER_OWNER: 'envowner', VITE_TIMBER_OAUTH_CLIENT_ID: 'env-cid' },
    );
    expect(c.owner).toBe('envowner');
    expect(c.oauth.clientId).toBe('env-cid');
  });
});

describe('repoConfig (window.__TIMBER_CONFIG__ glue)', () => {
  afterEach(() => {
    delete (window as unknown as { __TIMBER_CONFIG__?: unknown }).__TIMBER_CONFIG__;
    vi.resetModules();
  });

  it('reads the runtime global injected by config.js at module load', async () => {
    (window as unknown as { __TIMBER_CONFIG__?: RuntimeConfig }).__TIMBER_CONFIG__ = {
      owner: 'winowner',
      repo: 'winrepo',
      oauth: { clientId: 'win-cid', brokerUrl: 'https://win.broker', scope: '' },
    };
    vi.resetModules();
    const { repoConfig } = await import('../src/host/config.js');
    expect(repoConfig.owner).toBe('winowner');
    expect(repoConfig.repo).toBe('winrepo');
    expect(repoConfig.oauth.clientId).toBe('win-cid');
    expect(repoConfig.oauth.scope).toBe('');
  });
});
