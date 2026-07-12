import { describe, it, expect, vi } from 'vitest';
import { AssetStore } from '../src/state/assets.js';

// Runs in real Chromium because AssetStore.stage uses URL.createObjectURL, which
// jsdom does not implement.
describe('AssetStore.ensure (lazy re-fetch of committed bytes)', () => {
  it('returns undefined when nothing is staged and there is no loader', async () => {
    const store = new AssetStore();
    expect(await store.ensure('x/y.webp')).toBeUndefined();
  });

  it('returns a staged url without invoking the loader', async () => {
    const loader = vi.fn();
    const store = new AssetStore(loader);
    const { url } = store.stage('x/y.webp', new Blob(['a']));
    expect(await store.ensure('x/y.webp')).toBe(url);
    expect(loader).not.toHaveBeenCalled();
  });

  it('fetches via the loader once, caching and deduping concurrent calls', async () => {
    const loader = vi.fn(async () => new Blob(['bytes'], { type: 'image/webp' }));
    const store = new AssetStore(loader);
    const [a, b] = await Promise.all([store.ensure('p.webp'), store.ensure('p.webp')]);
    expect(a).toMatch(/^blob:/);
    expect(a).toBe(b);
    await store.ensure('p.webp'); // now cached
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when the loader has no bytes for the path', async () => {
    const store = new AssetStore(async () => undefined);
    expect(await store.ensure('missing.webp')).toBeUndefined();
  });
});
