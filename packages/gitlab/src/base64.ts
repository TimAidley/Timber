/**
 * Isomorphic UTF-8 <-> base64 helpers (GitLab's files/blobs API speaks base64,
 * like GitHub's/Gitea's). Deliberately avoids Node's `Buffer` so this adapter runs unchanged
 * in the browser — `atob`/`btoa` are global in Node 16+ and all browsers. (Kept local
 * to this package so the GitLab adapter has no dependency on `@timber/github`.)
 */
export function base64ToUtf8(base64: string): string {
  const binary = atob(base64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** Decode base64 content to raw bytes (e.g. a committed image, not text). */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64.replace(/\n/g, ''));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Encode raw bytes (e.g. a processed image) to base64 for a contents-API write. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
