import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug, referrersTo } from '../src/index.js';
import type { ContentModel, ContentObject, ContentTypeSchema } from '../src/index.js';

describe('slugify', () => {
  it('lowercases, dashes spaces, and strips punctuation', () => {
    expect(slugify('Summer Fête 2026!')).toBe('summer-fte-2026');
    expect(slugify('  Hello   World  ')).toBe('hello-world');
    expect(slugify('already-a-slug')).toBe('already-a-slug');
    expect(slugify('Under_scores_too')).toBe('under-scores-too');
  });

  it('yields an empty string for an all-punctuation title', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('uniqueSlug', () => {
  it('returns the base when free', () => {
    expect(uniqueSlug('fete', new Set())).toBe('fete');
  });

  it('appends an incrementing suffix when taken', () => {
    expect(uniqueSlug('fete', new Set(['fete']))).toBe('fete-2');
    expect(uniqueSlug('fete', new Set(['fete', 'fete-2']))).toBe('fete-3');
  });

  it('falls back to "untitled" for a blank base', () => {
    expect(uniqueSlug('', new Set())).toBe('untitled');
    expect(uniqueSlug('', new Set(['untitled']))).toBe('untitled-2');
  });
});

describe('referrersTo', () => {
  function makeModel(): ContentModel {
    const events: ContentTypeSchema = {
      name: 'events',
      kind: 'collection',
      fields: { title: { type: 'text' }, speaker: { type: 'reference', referenceType: 'people' } },
    };
    const people: ContentTypeSchema = { name: 'people', kind: 'collection', fields: { title: { type: 'text' } } };
    const jane: ContentObject = {
      type: 'people', kind: 'collection', id: 'p-jane', slug: 'jane', path: 'content/people/jane/index.md',
      data: { id: 'p-jane', title: 'Jane' }, body: '', public: true,
    };
    const fete: ContentObject = {
      type: 'events', kind: 'collection', id: 'e-fete', slug: 'fete', path: 'content/events/fete/index.md',
      data: { id: 'e-fete', title: 'Fete', speaker: 'p-jane' }, body: '', public: true,
    };
    const gala: ContentObject = {
      type: 'events', kind: 'collection', id: 'e-gala', slug: 'gala', path: 'content/events/gala/index.md',
      data: { id: 'e-gala', title: 'Gala' }, body: '', public: true,
    };
    return {
      schemas: new Map([['events', events], ['people', people]]),
      objects: [jane, fete, gala],
      byId: new Map([['p-jane', jane], ['e-fete', fete], ['e-gala', gala]]),
      errors: [],
    };
  }

  it('finds objects whose reference field points at the id', () => {
    const referrers = referrersTo(makeModel(), 'p-jane');
    expect(referrers.map((o) => o.id)).toEqual(['e-fete']);
  });

  it('returns [] when nothing references the id', () => {
    expect(referrersTo(makeModel(), 'e-gala')).toEqual([]);
  });
});
