import { describe, expect, it } from 'vitest';
import { loadNavigation } from '../src/navigation.js';
import type { RepoSnapshot } from '../src/types.js';

const resolve = (id: string): string | undefined =>
  ({ 'PAGE-HOME': '/', 'PAGE-ABOUT': '/pages/about/' })[id];

function snap(nav: string): RepoSnapshot {
  return new Map([['config/navigation.yml', nav]]);
}

describe('loadNavigation', () => {
  it('returns [] when there is no nav config', () => {
    expect(loadNavigation(new Map(), resolve)).toEqual([]);
  });

  it('reads a list of { label, url } and { label, ref } in order', () => {
    const nav = loadNavigation(
      snap('- label: Home\n  ref: PAGE-HOME\n- label: About\n  ref: PAGE-ABOUT\n- label: Blog\n  url: /blog/\n'),
      resolve,
    );
    expect(nav).toEqual([
      { label: 'Home', url: '/' },
      { label: 'About', url: '/pages/about/' },
      { label: 'Blog', url: '/blog/' },
    ]);
  });

  it('accepts an { items: [...] } wrapper too', () => {
    const nav = loadNavigation(snap('items:\n  - label: Home\n    url: /\n'), resolve);
    expect(nav).toEqual([{ label: 'Home', url: '/' }]);
  });

  it('skips dangling refs and entries without a label', () => {
    const nav = loadNavigation(
      snap('- label: Missing\n  ref: NOPE\n- url: /no-label/\n- label: Home\n  ref: PAGE-HOME\n'),
      resolve,
    );
    expect(nav).toEqual([{ label: 'Home', url: '/' }]);
  });
});
