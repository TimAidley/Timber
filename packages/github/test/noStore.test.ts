import { describe, expect, it, vi } from 'vitest';
import { noStoreFetch } from '../src/noStore.js';

/**
 * GitHub serves REST reads with `Cache-Control: private, max-age=60`. Left alone, a
 * browser answers the next branch-tip read from its own cache — so after another tab
 * commits, every rebuild targets a stale parent and every save fails "not a fast
 * forward" for a full minute, with the retries never reaching GitHub at all. Hence:
 * mutable reads bypass the cache; sha-addressed (immutable) ones keep it.
 */

function spyFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response('{}', { status: 200 }));
}

const REF_URL = 'https://api.github.com/repos/o/r/git/ref/heads%2Fme_wip';

describe('noStoreFetch', () => {
  it('bypasses the HTTP cache for a branch-tip read', async () => {
    const base = spyFetch();
    await noStoreFetch(base as unknown as typeof fetch)(REF_URL);
    expect(base.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('bypasses it for every other mutable read and for writes', async () => {
    const base = spyFetch();
    const f = noStoreFetch(base as unknown as typeof fetch);
    for (const url of [
      'https://api.github.com/repos/o/r',
      'https://api.github.com/repos/o/r/compare/main...me_wip',
      'https://api.github.com/repos/o/r/contents/content/pages/home/index.md?ref=me_wip',
      'https://api.github.com/repos/o/r/actions/workflows/deploy.yml/runs?branch=main',
    ]) {
      await f(url);
    }
    expect(base.mock.calls.every((c) => (c[1] as RequestInit).cache === 'no-store')).toBe(true);
  });

  it('keeps caching content addressed by sha — it cannot change under us', async () => {
    const base = spyFetch();
    const f = noStoreFetch(base as unknown as typeof fetch);
    const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    for (const url of [
      `https://api.github.com/repos/o/r/git/blobs/${sha}`,
      `https://api.github.com/repos/o/r/git/trees/${sha}?recursive=1`,
      `https://api.github.com/repos/o/r/git/commits/${sha}`,
    ]) {
      await f(url);
    }
    expect(base.mock.calls.every((c) => (c[1] as RequestInit).cache === 'default')).toBe(true);
  });

  it('does not mistake a *ref* read for sha-addressed content', async () => {
    // `/git/ref/heads/<branch>` and `/git/refs/...` must never be cached, however they
    // are spelled — this is the read the whole bug hinged on.
    const base = spyFetch();
    const f = noStoreFetch(base as unknown as typeof fetch);
    await f('https://api.github.com/repos/o/r/git/refs/heads%2Fme_wip');
    await f(new URL(REF_URL));
    await f(new Request(REF_URL));
    expect(base.mock.calls.every((c) => (c[1] as RequestInit).cache === 'no-store')).toBe(true);
  });

  it('preserves the rest of the request init', async () => {
    const base = spyFetch();
    await noStoreFetch(base as unknown as typeof fetch)(REF_URL, {
      method: 'PATCH',
      headers: { authorization: 'Bearer x' },
      body: '{}',
    });
    expect(base.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      headers: { authorization: 'Bearer x' },
      body: '{}',
      cache: 'no-store',
    });
  });
});
