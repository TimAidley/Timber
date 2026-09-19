import { describe, expect, it } from 'vitest';
import {
  loadNavigation,
  navigationReferrers,
  navigationSource,
  parseNavigation,
  serializeNavigation,
  validateNavigation,
} from '../src/navigation.js';
import type { ContentModel, ContentObject, RepoSnapshot } from '../src/types.js';

const resolve = (id: string): string | undefined =>
  ({ 'PAGE-HOME': '/', 'PAGE-ABOUT': '/pages/about/' })[id];

function snap(nav: string): RepoSnapshot {
  return new Map([['config/navigation.yml', nav]]);
}

function object(id: string): ContentObject {
  return {
    type: 'pages',
    kind: 'collection',
    id,
    slug: id.toLowerCase(),
    path: `content/pages/${id.toLowerCase()}/index.md`,
    data: { id, title: id },
    body: '',
    public: true,
  };
}

function model(objects: ContentObject[]): ContentModel {
  return {
    schemas: new Map(),
    objects,
    byId: new Map(objects.map((o) => [o.id as string, o])),
    byTranslation: new Map(),
    errors: [],
  };
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

  it('reads the .yaml spelling too', () => {
    const nav = loadNavigation(new Map([['config/navigation.yaml', '- label: Home\n  url: /\n']]), resolve);
    expect(nav).toEqual([{ label: 'Home', url: '/' }]);
  });

  it('survives malformed YAML rather than breaking the build', () => {
    expect(loadNavigation(snap('- label: [unclosed\n'), resolve)).toEqual([]);
  });
});

describe('navigationSource', () => {
  it('finds the file and reports which spelling it used', () => {
    expect(navigationSource(snap('- label: Home\n  url: /\n'))).toEqual({
      path: 'config/navigation.yml',
      raw: '- label: Home\n  url: /\n',
    });
  });

  it('is undefined when the site has no nav config', () => {
    expect(navigationSource(new Map())).toBeUndefined();
  });
});

describe('parseNavigation', () => {
  it('keeps malformed entries rather than dropping them, so they can be reported', () => {
    expect(parseNavigation('- label: Missing\n  ref: NOPE\n- url: /no-label/\n- label: Nowhere\n')).toEqual([
      { label: 'Missing', ref: 'NOPE' },
      { label: '', url: '/no-label/' },
      { label: 'Nowhere' },
    ]);
  });

  it('prefers an explicit url when an entry carries both', () => {
    expect(parseNavigation('- label: Both\n  url: /x/\n  ref: PAGE-HOME\n')).toEqual([
      { label: 'Both', url: '/x/' },
    ]);
  });

  it('drops list items that are not objects at all', () => {
    expect(parseNavigation('- just a string\n- label: Home\n  url: /\n')).toEqual([
      { label: 'Home', url: '/' },
    ]);
  });
});

describe('serializeNavigation', () => {
  it('round-trips authored entries', () => {
    const entries = [
      { label: 'Home', ref: 'PAGE-HOME' },
      { label: 'Blog', url: '/blog/' },
    ];
    expect(parseNavigation(serializeNavigation(entries))).toEqual(entries);
  });

  it('writes an empty list the parser reads back as empty', () => {
    expect(parseNavigation(serializeNavigation([]))).toEqual([]);
  });
});

describe('validateNavigation', () => {
  const m = model([object('PAGE-HOME')]);

  it('reports a ref that no longer resolves', () => {
    const problems = validateNavigation(parseNavigation('- label: Gone\n  ref: NOPE\n'), m);
    expect(problems).toEqual([
      { index: 0, kind: 'dangling-ref', message: '"Gone" points at a missing object (NOPE)' },
    ]);
  });

  it('reports an entry with no target and one with no label', () => {
    const problems = validateNavigation(parseNavigation('- label: Nowhere\n- url: /x/\n'), m);
    expect(problems.map((p) => [p.index, p.kind])).toEqual([
      [0, 'no-target'],
      [1, 'no-label'],
    ]);
  });

  it('is silent on a healthy nav', () => {
    expect(validateNavigation(parseNavigation('- label: Home\n  ref: PAGE-HOME\n- label: Blog\n  url: /blog/\n'), m)).toEqual([]);
  });
});

describe('navigationReferrers', () => {
  it('finds the menu entries pointing at an object', () => {
    const entries = parseNavigation('- label: Home\n  ref: PAGE-HOME\n- label: Blog\n  url: /blog/\n');
    expect(navigationReferrers(entries, 'PAGE-HOME')).toEqual([{ label: 'Home', ref: 'PAGE-HOME' }]);
    expect(navigationReferrers(entries, 'PAGE-ABOUT')).toEqual([]);
  });
});
