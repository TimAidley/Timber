import { describe, expect, it } from 'vitest';
import type { ContentObject, ContentTypeSchema } from '@timber/content';
import {
  CREATED_SORT,
  NAME_SORT,
  clusterMissingLanguages,
  clusterTranslations,
  filterByName,
  filterClusters,
  groupByType,
  objectName,
  sortClusters,
  sortObjects,
  sortOptions,
} from '../src/content/contentList.js';

function obj(partial: Partial<ContentObject> & { type: string; slug: string }): ContentObject {
  return {
    kind: 'collection',
    path: `content/${partial.type}/${partial.slug}/index.md`,
    data: {},
    body: '',
    public: false,
    ...partial,
  };
}

const events: ContentTypeSchema = {
  name: 'events',
  kind: 'collection',
  fields: {
    title: { type: 'text' },
    start: { type: 'date', label: 'Start date' },
    capacity: { type: 'number' },
  },
};

describe('objectName', () => {
  it('prefers the title, falls back to the slug', () => {
    expect(objectName(obj({ type: 'e', slug: 'a', data: { title: 'Hello' } }))).toBe('Hello');
    expect(objectName(obj({ type: 'e', slug: 'no-title' }))).toBe('no-title');
  });
});

describe('groupByType', () => {
  it('groups objects by type, groups ordered alphabetically', () => {
    const groups = groupByType([
      obj({ type: 'pages', slug: 'p1' }),
      obj({ type: 'events', slug: 'e1' }),
      obj({ type: 'pages', slug: 'p2' }),
    ]);
    expect(groups.map((g) => g.type)).toEqual(['events', 'pages']);
    expect(groups[1]?.objects).toHaveLength(2);
  });
});

describe('filterByName', () => {
  const list = [
    obj({ type: 'e', slug: 'a', data: { title: 'Summer Fair' } }),
    obj({ type: 'e', slug: 'b', data: { title: 'Winter Market' } }),
    obj({ type: 'e', slug: 'winter-notes' }),
  ];

  it('returns everything for a blank query', () => {
    expect(filterByName(list, '   ')).toHaveLength(3);
  });

  it('matches title or slug, case-insensitively', () => {
    const hits = filterByName(list, 'winter');
    expect(hits.map((o) => o.slug)).toEqual(['b', 'winter-notes']);
  });
});

describe('sortOptions', () => {
  it('offers Name, Created, then the type fields (excluding title)', () => {
    const opts = sortOptions(events);
    expect(opts.map((o) => o.value)).toEqual([NAME_SORT, CREATED_SORT, 'start', 'capacity']);
    expect(opts.find((o) => o.value === 'start')?.label).toBe('Start date');
  });

  it('offers just Name and Created when the type is unknown', () => {
    expect(sortOptions(undefined).map((o) => o.value)).toEqual([NAME_SORT, CREATED_SORT]);
  });
});

describe('sortObjects', () => {
  it('sorts by name ascending and descending', () => {
    const list = [
      obj({ type: 'e', slug: 'a', data: { title: 'Banana' } }),
      obj({ type: 'e', slug: 'b', data: { title: 'apple' } }),
      obj({ type: 'e', slug: 'c', data: { title: 'Cherry' } }),
    ];
    expect(
      sortObjects(list, { key: NAME_SORT, dir: 'asc' }, events).map((o) => o.data.title),
    ).toEqual(['apple', 'Banana', 'Cherry']);
    expect(
      sortObjects(list, { key: NAME_SORT, dir: 'desc' }, events).map((o) => o.data.title),
    ).toEqual(['Cherry', 'Banana', 'apple']);
  });

  it('sorts by creation date newest-first when descending', () => {
    const list = [
      obj({ type: 'e', slug: 'old', data: { title: 'Old', created: '2024-01-01T00:00:00Z' } }),
      obj({ type: 'e', slug: 'new', data: { title: 'New', created: '2026-01-01T00:00:00Z' } }),
    ];
    expect(
      sortObjects(list, { key: CREATED_SORT, dir: 'desc' }, events).map((o) => o.slug),
    ).toEqual(['new', 'old']);
  });

  it('sorts by a numeric field numerically, not lexically', () => {
    const list = [
      obj({ type: 'e', slug: 'a', data: { capacity: 100 } }),
      obj({ type: 'e', slug: 'b', data: { capacity: 9 } }),
      obj({ type: 'e', slug: 'c', data: { capacity: 20 } }),
    ];
    expect(
      sortObjects(list, { key: 'capacity', dir: 'asc' }, events).map((o) => o.data.capacity),
    ).toEqual([9, 20, 100]);
  });

  it('sorts by a date field chronologically', () => {
    const list = [
      obj({ type: 'e', slug: 'a', data: { start: '2026-03-10' } }),
      obj({ type: 'e', slug: 'b', data: { start: '2026-01-05' } }),
    ];
    expect(
      sortObjects(list, { key: 'start', dir: 'asc' }, events).map((o) => o.data.start),
    ).toEqual(['2026-01-05', '2026-03-10']);
  });

  it('always sorts empty values last, regardless of direction', () => {
    const list = [
      obj({ type: 'e', slug: 'has', data: { title: 'Has', capacity: 5 } }),
      obj({ type: 'e', slug: 'none', data: { title: 'None' } }),
    ];
    expect(
      sortObjects(list, { key: 'capacity', dir: 'asc' }, events).map((o) => o.slug),
    ).toEqual(['has', 'none']);
    expect(
      sortObjects(list, { key: 'capacity', dir: 'desc' }, events).map((o) => o.slug),
    ).toEqual(['has', 'none']);
  });

  it('does not mutate the input array', () => {
    const list = [
      obj({ type: 'e', slug: 'b', data: { title: 'B' } }),
      obj({ type: 'e', slug: 'a', data: { title: 'A' } }),
    ];
    const before = list.map((o) => o.slug);
    sortObjects(list, { key: NAME_SORT, dir: 'asc' }, events);
    expect(list.map((o) => o.slug)).toEqual(before);
  });
});

describe('clusterTranslations', () => {
  const langs = ['en', 'fr', 'de'];
  const en = obj({
    type: 'posts',
    slug: 'hello',
    lang: 'en',
    translationKey: 'G',
    data: { title: 'Hello' },
  });
  const fr = obj({
    type: 'posts',
    slug: 'bonjour',
    lang: 'fr',
    translationKey: 'G',
    data: { title: 'Bonjour' },
  });
  const lone = obj({ type: 'posts', slug: 'solo', lang: 'en', data: { title: 'Solo' } });

  it('groups variants sharing a translationKey into one cluster', () => {
    const clusters = clusterTranslations([en, fr, lone], langs, 'en');
    expect(clusters).toHaveLength(2);
    const group = clusters.find((c) => c.key === 'G')!;
    expect([...group.variants.keys()].sort()).toEqual(['en', 'fr']);
    // An untranslated object is its own singleton cluster.
    expect(clusters.some((c) => c.key.startsWith('__lone:'))).toBe(true);
  });

  it('picks the default-language variant as representative', () => {
    const clusters = clusterTranslations([fr, en], langs, 'en');
    expect(clusters[0]!.representative).toBe(en);
  });

  it('falls back to the lowest site-language rank when the default is absent', () => {
    const clusters = clusterTranslations([fr], langs, 'en'); // no en variant
    expect(clusters[0]!.representative).toBe(fr);
  });

  it('reports the missing languages of a cluster', () => {
    const clusters = clusterTranslations([en, fr], langs, 'en');
    expect(clusterMissingLanguages(clusters[0]!, langs)).toEqual(['de']);
    // A fully-covered object has no gaps.
    expect(clusterMissingLanguages(clusterTranslations([lone], ['en'], 'en')[0]!, ['en'])).toEqual([]);
  });

  it('filters clusters by any variant name, and sorts by representative', () => {
    const clusters = clusterTranslations([en, fr, lone], langs, 'en');
    // "bonjour" only matches the French variant, but keeps its whole cluster.
    expect(filterClusters(clusters, 'bonjour').map((c) => c.key)).toEqual(['G']);

    const sorted = sortClusters(clusters, { key: NAME_SORT, dir: 'asc' }, undefined);
    // Representatives are "Hello" (G) and "Solo" (lone) → alphabetical.
    expect(sorted.map((c) => objectName(c.representative))).toEqual(['Hello', 'Solo']);
  });
});
