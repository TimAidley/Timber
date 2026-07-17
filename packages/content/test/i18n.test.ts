import { describe, expect, it } from 'vitest';
import {
  assembleCollections,
  assembleContent,
  loadSchemas,
  translationsOf,
  urlFor,
  type ContentModel,
  type ContentObject,
  type RepoSnapshot,
} from '../src/index.js';

/** Build a RepoSnapshot from a literal path→contents map. */
function snap(files: Record<string, string>): RepoSnapshot {
  return new Map(Object.entries(files));
}

const POSTS_SCHEMA = `kind: collection
hasBody: true
fields:
  title:
    type: text
    required: true
`;

const SETTINGS_SCHEMA = `kind: singleton
page: false
hasBody: false
fields:
  title:
    type: text
`;

/** Front matter for a post bundle. */
function post(front: string, body = 'Body.'): string {
  return `---\n${front}\n---\n${body}\n`;
}

function build(files: Record<string, string>): ContentModel {
  const snapshot = snap(files);
  return assembleContent(snapshot, loadSchemas(snapshot));
}

function at(model: ContentModel, path: string): ContentObject {
  const obj = model.objects.find((o) => o.path === path);
  if (!obj) throw new Error(`no object at ${path}`);
  return obj;
}

// A representative i18n-enabled site: two declared languages, one translation group
// spread across an explicit-lang path (en) and a front-matter lang (fr), plus a
// default-language object with no lang marker at all.
const I18N_SITE = {
  'config/schemas/posts.yml': POSTS_SCHEMA,
  'config/schemas/settings.yml': SETTINGS_SCHEMA,
  'content/settings/index.md': post('title: Multi\nlanguages:\n  - en\n  - fr\ndefaultLanguage: en'),
  // explicit language folder
  'content/posts/en/hello/index.md': post('id: P-EN\ntitle: Hello\ntranslationKey: G1\npublic: true'),
  // language from front matter, bundle sits at the 2-deep (no-lang) path
  'content/posts/bonjour/index.md': post('id: P-FR\ntitle: Bonjour\nlang: fr\ntranslationKey: G1\npublic: true'),
  // no language marker at all → falls back to the site default (en)
  'content/posts/plain/index.md': post('id: P-PLAIN\ntitle: Plain\npublic: true'),
};

describe('i18n assembly (SPEC §5 → Multilingual)', () => {
  it('derives lang from the path segment and prefixes the URL', () => {
    const model = build(I18N_SITE);
    const hello = at(model, 'content/posts/en/hello/index.md');
    expect(hello.lang).toBe('en');
    expect(hello.slug).toBe('hello');
    expect(urlFor(hello, model.schemas.get('posts')!)).toBe('/en/posts/hello/');
  });

  it('honors a front-matter lang when there is no language path segment', () => {
    const model = build(I18N_SITE);
    const bonjour = at(model, 'content/posts/bonjour/index.md');
    expect(bonjour.lang).toBe('fr');
    expect(urlFor(bonjour, model.schemas.get('posts')!)).toBe('/fr/posts/bonjour/');
  });

  it('falls back to the default language when an object carries no lang', () => {
    const model = build(I18N_SITE);
    const plain = at(model, 'content/posts/plain/index.md');
    expect(plain.lang).toBe('en');
    expect(urlFor(plain, model.schemas.get('posts')!)).toBe('/en/posts/plain/');
  });

  it('builds the translation index and links siblings by translationKey', () => {
    const model = build(I18N_SITE);
    const group = model.byTranslation.get('G1');
    expect(group && [...group.keys()].sort()).toEqual(['en', 'fr']);

    const hello = at(model, 'content/posts/en/hello/index.md');
    const translations = translationsOf(model, hello);
    // Includes the object itself, sorted by language code.
    expect(translations).toEqual([
      { lang: 'en', url: '/en/posts/hello/', title: 'Hello' },
      { lang: 'fr', url: '/fr/posts/bonjour/', title: 'Bonjour' },
    ]);
  });

  it('returns no translations for an object without a translationKey', () => {
    const model = build(I18N_SITE);
    expect(translationsOf(model, at(model, 'content/posts/plain/index.md'))).toEqual([]);
  });

  it('carries lang onto collection entries so templates can filter by it', () => {
    const model = build(I18N_SITE);
    const collections = assembleCollections(model, urlFor);
    const langs = collections.posts?.map((e) => e.lang).sort();
    expect(langs).toEqual(['en', 'en', 'fr']); // hello(en), plain(en), bonjour(fr)
  });

  it('flags a language that is not in the declared set', () => {
    const model = build({
      ...I18N_SITE,
      'content/posts/de/hallo/index.md': post('id: P-DE\ntitle: Hallo\npublic: true'),
    });
    const bad = model.errors.filter((e) => e.kind === 'unknown-language');
    expect(bad).toHaveLength(1);
    expect(bad[0]?.message).toContain('de');
  });

  it('flags two objects claiming the same language in one translation group', () => {
    const model = build({
      'config/schemas/posts.yml': POSTS_SCHEMA,
      'config/schemas/settings.yml': SETTINGS_SCHEMA,
      'content/settings/index.md': post('title: Multi\nlanguages:\n  - en\n  - fr'),
      'content/posts/en/a/index.md': post('id: A\ntitle: A\ntranslationKey: DUP\npublic: true'),
      'content/posts/en/b/index.md': post('id: B\ntitle: B\ntranslationKey: DUP\npublic: true'),
    });
    const conflicts = model.errors.filter((e) => e.kind === 'translation-conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.paths).toHaveLength(2);
  });
});

describe('single-language sites are unaffected (i18n opt-in)', () => {
  const MONO = {
    'config/schemas/posts.yml': POSTS_SCHEMA,
    'config/schemas/settings.yml': SETTINGS_SCHEMA,
    'content/settings/index.md': post('title: Solo'), // no `languages`
    'content/posts/hello/index.md': post('id: P\ntitle: Hello\npublic: true'),
  };

  it('assigns no lang and leaves URLs unprefixed', () => {
    const model = build(MONO);
    const hello = at(model, 'content/posts/hello/index.md');
    expect(hello.lang).toBeUndefined();
    expect(urlFor(hello, model.schemas.get('posts')!)).toBe('/posts/hello/');
  });

  it('omits lang from collection entries', () => {
    const model = build(MONO);
    const entry = assembleCollections(model, urlFor).posts?.[0];
    expect(entry && 'lang' in entry).toBe(false);
  });
});
