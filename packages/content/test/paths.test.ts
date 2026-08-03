import { describe, expect, it } from 'vitest';
import { isCollectionIndexPath, isContentPath, parseObjectPath } from '../src/paths.js';

describe('parseObjectPath (the one object-path grammar)', () => {
  it('parses a singleton', () => {
    expect(parseObjectPath('content/settings/index.md')).toEqual({ type: 'settings' });
  });

  it('parses a collection object', () => {
    expect(parseObjectPath('content/events/fete/index.md')).toEqual({
      type: 'events',
      slug: 'fete',
    });
  });

  it('parses a multilingual collection object', () => {
    expect(parseObjectPath('content/events/fr/fete/index.md')).toEqual({
      type: 'events',
      lang: 'fr',
      slug: 'fete',
    });
  });

  it('rejects non-object paths', () => {
    expect(parseObjectPath('content/events/fete/hero.webp')).toBeUndefined();
    expect(parseObjectPath('themes/acme/templates/default.liquid')).toBeUndefined();
    expect(parseObjectPath('content/events/a/b/c/index.md')).toBeUndefined();
  });
});

describe('isCollectionIndexPath', () => {
  it('accepts both collection shapes and rejects singletons and assets', () => {
    expect(isCollectionIndexPath('content/events/fete/index.md')).toBe(true);
    expect(isCollectionIndexPath('content/events/fr/fete/index.md')).toBe(true);
    expect(isCollectionIndexPath('content/settings/index.md')).toBe(false);
    expect(isCollectionIndexPath('content/events/fete/hero.webp')).toBe(false);
  });
});

describe('isContentPath', () => {
  it('is a plain content-area prefix test', () => {
    expect(isContentPath('content/events/fete/hero.webp')).toBe(true);
    expect(isContentPath('config/schemas/events.yml')).toBe(false);
    expect(isContentPath('contents/nope.md')).toBe(false);
  });
});
