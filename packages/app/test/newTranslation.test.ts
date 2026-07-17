import { describe, expect, it } from 'vitest';
import type { ContentObject } from '@timber/content';
import { newTranslation } from '../src/content/newTranslation.js';
import { newObject } from '../src/content/newObject.js';

const postsSchema = { name: 'posts', kind: 'collection' as const, fields: {} };

function source(overrides: Partial<ContentObject> = {}): ContentObject {
  return {
    type: 'posts',
    kind: 'collection',
    id: 'SRC',
    slug: 'hello',
    lang: 'en',
    translationKey: 'GROUP',
    path: 'content/posts/en/hello/index.md',
    data: {
      id: 'SRC',
      title: 'Hello',
      lang: 'en',
      translationKey: 'GROUP',
      hero: 'content/posts/en/hello/hero.webp',
      public: true,
      aliases: ['old-hello'],
      tags: ['a', 'b'],
    },
    body: 'Original **body**.',
    public: true,
    ...overrides,
  };
}

describe('newTranslation', () => {
  it('duplicates the source into the target language as a draft', () => {
    const { translation, mintedKey } = newTranslation(source(), 'fr', new Set());
    expect(mintedKey).toBe(false); // source already had a key
    expect(translation.lang).toBe('fr');
    expect(translation.path).toBe('content/posts/fr/hello/index.md');
    expect(translation.translationKey).toBe('GROUP');
    expect(translation.body).toBe('Original **body**.'); // copied to translate in place
    // Draft, with no inherited public flag or old-URL aliases.
    expect(translation.public).toBe(false);
    expect(translation.data.public).toBeUndefined();
    expect(translation.data.aliases).toBeUndefined();
    // Structured field copied through.
    expect(translation.data.tags).toEqual(['a', 'b']);
  });

  it('gives the translation a fresh id distinct from the source', () => {
    const { translation } = newTranslation(source(), 'fr', new Set());
    expect(translation.id).toBeDefined();
    expect(translation.id).not.toBe('SRC');
    expect(translation.data.id).toBe(translation.id);
  });

  it('repoints front-matter paths that lived in the source bundle', () => {
    const { translation } = newTranslation(source(), 'fr', new Set());
    expect(translation.data.hero).toBe('content/posts/fr/hello/hero.webp');
  });

  it('mints a shared key when the source lacks one, and flags it for backfill', () => {
    const noKey = source({ translationKey: undefined });
    delete noKey.data.translationKey;
    const { translation, translationKey, mintedKey } = newTranslation(noKey, 'fr', new Set());
    expect(mintedKey).toBe(true);
    expect(translationKey).toBeDefined();
    expect(translation.translationKey).toBe(translationKey);
    expect(translation.data.translationKey).toBe(translationKey);
  });

  it('avoids a slug collision within the target language', () => {
    const { translation } = newTranslation(source(), 'fr', new Set(['hello']));
    expect(translation.slug).toBe('hello-2');
    expect(translation.path).toBe('content/posts/fr/hello-2/index.md');
  });
});

describe('newObject language awareness', () => {
  it('stamps the language into front matter and the bundle path when given', () => {
    const o = newObject('posts', 'Bonjour', postsSchema, new Set(), 'fr');
    expect(o.lang).toBe('fr');
    expect(o.data.lang).toBe('fr');
    expect(o.path).toBe('content/posts/fr/bonjour/index.md');
  });

  it('stays language-neutral (unprefixed path) on a single-language site', () => {
    const o = newObject('posts', 'Hello', postsSchema, new Set());
    expect(o.lang).toBeUndefined();
    expect(o.data.lang).toBeUndefined();
    expect(o.path).toBe('content/posts/hello/index.md');
  });
});
