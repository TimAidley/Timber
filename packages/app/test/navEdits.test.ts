import { describe, expect, it } from 'vitest';
import { parseNavigation, serializeNavigation, type ContentModel, type ContentObject, type ContentTypeSchema } from '@timber/content';
import { moveEntry, pageOptions, targetKind, withRef, withTargetKind } from '../src/advanced/navEdits.js';

function schema(name: string, page = true): ContentTypeSchema {
  return { name, kind: 'collection', fields: {}, ...(page ? {} : { page: false }) } as ContentTypeSchema;
}

function object(type: string, id: string, title: string): ContentObject {
  return {
    type,
    kind: 'collection',
    id,
    slug: id,
    path: `content/${type}/${id}/index.md`,
    data: { id, title },
    body: '',
    public: true,
  };
}

function model(schemas: ContentTypeSchema[], objects: ContentObject[]): ContentModel {
  return {
    schemas: new Map(schemas.map((s) => [s.name, s])),
    objects,
    byId: new Map(objects.map((o) => [o.id as string, o])),
    byTranslation: new Map(),
    errors: [],
  };
}

describe('targetKind', () => {
  it('reads a url entry as a URL link and everything else as a page link', () => {
    expect(targetKind({ label: 'Blog', url: '/blog/' })).toBe('url');
    expect(targetKind({ label: 'Home', ref: 'PAGE-HOME' })).toBe('page');
  });

  it('treats a brand-new entry with no target yet as a page row', () => {
    expect(targetKind({ label: '' })).toBe('page');
  });

  it('treats an empty url as a URL row, so switching kinds sticks before typing', () => {
    expect(targetKind({ label: '', url: '' })).toBe('url');
  });
});

describe('withTargetKind', () => {
  it('drops the ref when switching to a URL, so no entry carries both', () => {
    expect(withTargetKind({ label: 'Home', ref: 'PAGE-HOME' }, 'url')).toEqual({ label: 'Home', url: '' });
  });

  it('drops the url when switching to a page', () => {
    expect(withTargetKind({ label: 'Blog', url: '/blog/' }, 'page')).toEqual({ label: 'Blog' });
  });

  it('keeps a url already typed when re-selecting URL', () => {
    expect(withTargetKind({ label: 'Blog', url: '/blog/' }, 'url')).toEqual({ label: 'Blog', url: '/blog/' });
  });
});

describe('withRef', () => {
  it('sets a picked page and clears it again', () => {
    expect(withRef({ label: 'Home' }, 'PAGE-HOME')).toEqual({ label: 'Home', ref: 'PAGE-HOME' });
    expect(withRef({ label: 'Home', ref: 'PAGE-HOME' }, undefined)).toEqual({ label: 'Home' });
  });
});

describe('moveEntry', () => {
  const entries = [
    { label: 'A', url: '/a/' },
    { label: 'B', url: '/b/' },
    { label: 'C', url: '/c/' },
  ];

  it('moves an entry up and down', () => {
    expect(moveEntry(entries, 1, -1).map((e) => e.label)).toEqual(['B', 'A', 'C']);
    expect(moveEntry(entries, 1, 1).map((e) => e.label)).toEqual(['A', 'C', 'B']);
  });

  it('is a no-op off either end rather than wrapping around', () => {
    expect(moveEntry(entries, 0, -1)).toEqual(entries);
    expect(moveEntry(entries, 2, 1)).toEqual(entries);
  });

  it('survives a reorder round-tripping through YAML', () => {
    const moved = moveEntry(parseNavigation(serializeNavigation(entries)), 2, -1);
    expect(parseNavigation(serializeNavigation(moved)).map((e) => e.label)).toEqual(['A', 'C', 'B']);
  });
});

describe('pageOptions', () => {
  it('offers page-producing objects by title, excluding the settings singleton', () => {
    const m = model(
      [schema('pages'), schema('settings', false)],
      [
        object('pages', 'PAGE-ZEBRA', 'Zebra'),
        object('settings', 'SETTINGS', 'Site settings'),
        object('pages', 'PAGE-ABOUT', 'About'),
      ],
    );
    expect(pageOptions(m)).toEqual([
      { id: 'PAGE-ABOUT', label: 'About' },
      { id: 'PAGE-ZEBRA', label: 'Zebra' },
    ]);
  });

  it('falls back to the slug for an object with no title', () => {
    const untitled = object('pages', 'PAGE-X', '');
    untitled.data = { id: 'PAGE-X' };
    expect(pageOptions(model([schema('pages')], [untitled]))).toEqual([{ id: 'PAGE-X', label: 'PAGE-X' }]);
  });
});
