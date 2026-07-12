import { describe, expect, it } from 'vitest';
import type { ContentTypeSchema } from '@timber/content';
import { newObject } from '../src/content/newObject.js';

const events: ContentTypeSchema = {
  name: 'events',
  kind: 'collection',
  fields: { title: { type: 'text' }, start: { type: 'date', required: true } },
};

describe('newObject', () => {
  it('seeds a draft bundle with an id, unique slug, and title', () => {
    const obj = newObject('events', 'Summer Fête', events, new Set());
    expect(obj.type).toBe('events');
    expect(obj.slug).toBe('summer-fte');
    expect(obj.path).toBe('content/events/summer-fte/index.md');
    expect(obj.data.title).toBe('Summer Fête');
    expect(obj.data.id).toBe(obj.id);
    expect(typeof obj.id).toBe('string');
    // Draft by default: no public flag, required `start` left blank.
    expect(obj.public).toBe(false);
    expect(obj.data.start).toBeUndefined();
  });

  it('stamps a `created` ISO timestamp for creation-date sorting', () => {
    const obj = newObject('events', 'Timed', events, new Set());
    expect(typeof obj.data.created).toBe('string');
    expect(Number.isNaN(Date.parse(obj.data.created as string))).toBe(false);
  });

  it('avoids slug collisions within the type', () => {
    const obj = newObject('events', 'Fete', events, new Set(['fete']));
    expect(obj.slug).toBe('fete-2');
  });

  it('falls back to "Untitled"/"untitled" for a blank title', () => {
    const obj = newObject('events', '   ', events, new Set());
    expect(obj.data.title).toBe('Untitled');
    expect(obj.slug).toBe('untitled');
  });
});
