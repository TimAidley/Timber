import { describe, expect, it } from 'vitest';
import type { ContentModel, ContentObject, ContentTypeSchema } from '@timber/content';
import { livePageUrl } from '../src/content/liveUrl.js';

/**
 * The header's "View live" link must point where the *build* actually writes the page —
 * same `baseUrl` + routing (homepage-at-root, language prefix) — or not be offered at all.
 */

const pages: ContentTypeSchema = {
  name: 'pages',
  kind: 'collection',
  fields: { title: { type: 'text' } },
};
const settingsSchema: ContentTypeSchema = {
  name: 'settings',
  kind: 'singleton',
  page: false,
  fields: { title: { type: 'text' } },
};

function obj(
  partial: Partial<ContentObject> & { type: string; slug: string },
): ContentObject {
  return {
    kind: 'collection',
    path: `content/${partial.type}/${partial.slug}/index.md`,
    data: {},
    body: '',
    public: true,
    ...partial,
  };
}

function model(
  settingsData: Record<string, unknown>,
  ...objects: ContentObject[]
): ContentModel {
  const settings = obj({
    kind: 'singleton',
    type: 'settings',
    slug: 'settings',
    data: settingsData,
  });
  const all = [settings, ...objects];
  return {
    objects: all,
    schemas: new Map([
      ['pages', pages],
      ['settings', settingsSchema],
    ]),
    byId: new Map(all.filter((o) => o.id).map((o) => [o.id as string, o] as const)),
    byTranslation: new Map(),
    errors: [],
  };
}

describe('livePageUrl', () => {
  it('joins the settings baseUrl to the object’s routed path', () => {
    const about = obj({ type: 'pages', slug: 'about' });
    const m = model({ baseUrl: 'https://example.github.io/mysite' }, about);
    expect(livePageUrl(m, about, pages)).toBe(
      'https://example.github.io/mysite/pages/about/',
    );
  });

  it('tolerates a trailing slash on baseUrl (no doubled slash)', () => {
    const about = obj({ type: 'pages', slug: 'about' });
    const m = model({ baseUrl: 'https://example.test/' }, about);
    expect(livePageUrl(m, about, pages)).toBe('https://example.test/pages/about/');
  });

  it('points the homepage at the site root, matching the build’s routing', () => {
    const home = obj({ type: 'pages', slug: 'home', id: 'pages-home' });
    const m = model({ baseUrl: 'https://example.test', homepage: 'pages-home' }, home);
    expect(livePageUrl(m, home, pages)).toBe('https://example.test/');
  });

  it('keeps the language prefix on an i18n site', () => {
    const bonjour = obj({ type: 'pages', slug: 'bonjour', lang: 'fr' });
    const m = model({ baseUrl: 'https://example.test' }, bonjour);
    expect(livePageUrl(m, bonjour, pages)).toBe('https://example.test/fr/pages/bonjour/');
  });

  it('follows a type’s urlPattern', () => {
    const patterned: ContentTypeSchema = { ...pages, urlPattern: '/blog/{slug}/' };
    const post = obj({ type: 'pages', slug: 'hello' });
    const m = model({ baseUrl: 'https://example.test' }, post);
    expect(livePageUrl(m, post, patterned)).toBe('https://example.test/blog/hello/');
  });

  it('offers nothing when the site has no baseUrl', () => {
    const about = obj({ type: 'pages', slug: 'about' });
    expect(
      livePageUrl(model({ title: 'No base URL' }, about), about, pages),
    ).toBeUndefined();
  });

  it('offers nothing for a non-page type (a settings singleton has no page)', () => {
    const m = model({ baseUrl: 'https://example.test' });
    const settings = m.objects[0]!;
    expect(livePageUrl(m, settings, settingsSchema)).toBeUndefined();
  });

  it('refuses a non-http(s) baseUrl rather than turning it into an href', () => {
    const about = obj({ type: 'pages', slug: 'about' });
    for (const baseUrl of ['javascript:alert(1)', 'data:text/html,<b>x', 'not a url']) {
      expect(livePageUrl(model({ baseUrl }, about), about, pages)).toBeUndefined();
    }
  });
});
