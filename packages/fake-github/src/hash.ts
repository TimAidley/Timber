/**
 * Real git object hashing. The fake computes the SAME SHAs git would for a blob, tree,
 * or commit — `sha1("<type> <size>\0" + body)` — rather than minting random ids, so the
 * client's content-addressing assumptions hold honestly: an unchanged file re-uploaded
 * gets the same blob sha, an identical tree the same tree sha, and a seeded checkout of
 * `site-template/` hashes the way a real `git add` of it would. That makes a dump of
 * the fake's state comparable against a real repo when a test goes wrong.
 *
 * Web Crypto rather than `node:crypto` so the core runs unchanged in a browser (e.g.
 * behind an msw worker) as well as in Node behind a Playwright route.
 */

const encoder = new TextEncoder();

export type GitObjectType = 'blob' | 'tree' | 'commit';

export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function hexOf(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function bytesOfHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** The sha1 of a git object of `type` with the given serialized body. */
export async function gitObjectSha(
  type: GitObjectType,
  body: Uint8Array,
): Promise<string> {
  const header = encoder.encode(`${type} ${body.length}\0`);
  const digest = await crypto.subtle.digest('SHA-1', concatBytes(header, body));
  return hexOf(digest);
}

export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
