/**
 * GitHub answers REST reads with `Cache-Control: private, max-age=60`, so a browser
 * will serve a **minute-old branch tip** straight from its HTTP cache without touching
 * the network. For an editor doing read-modify-write against a branch that other tabs
 * are also writing to, that's fatal rather than merely stale:
 *
 *   1. another tab commits, moving `<login>_wip`;
 *   2. our ref read is a cache hit, so we still see the old tip;
 *   3. we build the commit on that parent and `updateRef` is rejected — "not a fast
 *      forward" — which is *correct*, the tip really did move;
 *   4. the retry re-reads the ref… and gets the same cached answer. Every attempt, and
 *      every backed-off flush after it, until the cache entry expires ~60s later.
 *
 * The author sees a run of save failures that fix themselves after a minute, and no
 * amount of retrying or waiting inside the client can shorten it — the request never
 * reaches GitHub. So reads must bypass the HTTP cache.
 *
 * One exception, deliberately kept: URLs that address content **by sha** (blobs, trees,
 * commits) are immutable, so caching them is both safe and worth having — it's what
 * makes re-displaying an already-fetched image cheap.
 */
const IMMUTABLE_BY_SHA = /\/git\/(?:blobs|trees|commits)\/[0-9a-f]{7,40}(?:$|[/?])/i;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Wrap a `fetch` so mutable reads never come from the HTTP cache. */
export function noStoreFetch(base: typeof fetch = fetch): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) =>
    base(input, {
      ...init,
      cache: IMMUTABLE_BY_SHA.test(urlOf(input)) ? 'default' : 'no-store',
    });
}
