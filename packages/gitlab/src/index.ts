/**
 * @timber/gitlab — a GitLab adapter for the `@timber/host` port (the third
 * {@link HostProvider} implementation). Talks the GitLab REST API v4 over `fetch`; no
 * SDK. Unlike the Codeberg adapter it provides a real {@link DeployBackend} backed by
 * GitLab CI/CD pipelines (GitLab Pages).
 */
export { GitLabClient } from './client.js';
export type { GitLabClientOptions, FetchLike } from './client.js';
export { base64ToUtf8, utf8ToBase64, bytesToBase64, base64ToBytes } from './base64.js';
