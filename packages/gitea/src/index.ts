/**
 * @timber/gitea — a Gitea / Forgejo (Codeberg) adapter for the `@timber/host` port
 * (the second {@link HostProvider} implementation, proving the seam is host-neutral).
 * Talks the Gitea REST API over `fetch`; no SDK, no Octokit.
 */
export { GiteaClient } from './client.js';
export type { GiteaClientOptions, FetchLike } from './client.js';
export { base64ToUtf8, utf8ToBase64, bytesToBase64, base64ToBytes } from './base64.js';
