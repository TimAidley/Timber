import { describe, expect, it } from 'vitest';
import type { RefComparison } from '@timber/github';
import { interpretComparison } from '../src/state/upstreamVersion.js';
import { canCheckForUpdate, resolveBuildInfo } from '../src/host/buildInfo.js';

function cmp(status: string, aheadBy: number, behindBy = 0): RefComparison {
  return { status, aheadBy, behindBy };
}

describe('interpretComparison', () => {
  it('is outdated when the followed ref is ahead of the build', () => {
    expect(interpretComparison(cmp('ahead', 3))).toEqual({
      state: 'outdated',
      behindBy: 3,
    });
  });

  it('is current when the ref is identical or behind', () => {
    expect(interpretComparison(cmp('identical', 0))).toEqual({ state: 'current' });
    expect(interpretComparison(cmp('behind', 0, 2))).toEqual({ state: 'current' });
  });

  it('counts a diverged ref by how far it is ahead', () => {
    expect(interpretComparison(cmp('diverged', 1, 5))).toEqual({
      state: 'outdated',
      behindBy: 1,
    });
  });
});

describe('resolveBuildInfo', () => {
  it('parses a full set of build vars', () => {
    const info = resolveBuildInfo({
      VITE_TIMBER_UPSTREAM_REPO: 'TimAidley/Timber',
      VITE_TIMBER_UPSTREAM_REF: 'main',
      VITE_TIMBER_BUILD_SHA: 'abc123',
    });
    expect(info).toEqual({
      upstream: { owner: 'TimAidley', repo: 'Timber' },
      ref: 'main',
      sha: 'abc123',
    });
    expect(canCheckForUpdate(info)).toBe(true);
  });

  it('treats empty vars as absent (a dev build) so no check runs', () => {
    const info = resolveBuildInfo({
      VITE_TIMBER_UPSTREAM_REPO: '',
      VITE_TIMBER_UPSTREAM_REF: 'main',
    });
    expect(info.upstream).toBeUndefined();
    expect(info.sha).toBeUndefined();
    expect(canCheckForUpdate(info)).toBe(false);
  });

  it('rejects a malformed owner/repo slug', () => {
    expect(
      resolveBuildInfo({ VITE_TIMBER_UPSTREAM_REPO: 'not-a-slug' }).upstream,
    ).toBeUndefined();
    expect(
      resolveBuildInfo({ VITE_TIMBER_UPSTREAM_REPO: 'a/b/c' }).upstream,
    ).toBeUndefined();
  });
});
