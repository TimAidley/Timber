import { describe, expect, it } from 'vitest';
import { siteContext, pageSeo, buildSitemap, buildRobots } from '../src/seo.js';
import type { ContentObject, ContentTypeSchema } from '../src/types.js';

function obj(data: Record<string, unknown>, slug = 'summer-fete', type = 'events'): ContentObject {
  return { type, kind: 'collection', slug, path: `content/${type}/${slug}/index.md`, data, body: '', public: true };
}

const eventsSchema: ContentTypeSchema = {
  name: 'events',
  kind: 'collection',
  fields: { title: { type: 'text' }, poster: { type: 'image' } },
};

const settings = obj(
  { title: 'My Site', description: 'A lovely site', baseUrl: 'https://example.com/' },
  'settings',
  'settings',
);

describe('siteContext', () => {
  it('exposes settings and trims the base URL', () => {
    const site = siteContext(settings);
    expect(site.title).toBe('My Site');
    expect(site.baseUrl).toBe('https://example.com'); // trailing slash trimmed
  });

  it('is empty when there is no settings singleton', () => {
    expect(siteContext(undefined)).toEqual({});
  });
});

describe('pageSeo', () => {
  const site = siteContext(settings);

  it('suffixes the page title with the site title', () => {
    const seo = pageSeo(obj({ title: 'Summer Fete' }), eventsSchema, site);
    expect(seo.title).toBe('Summer Fete · My Site');
    expect(seo.ogTitle).toBe('Summer Fete');
  });

  it('prefers seoTitle and description, falling back to site description', () => {
    const seo = pageSeo(obj({ title: 'T', seoTitle: 'Custom', description: 'D' }), eventsSchema, site);
    expect(seo.title).toBe('Custom · My Site');
    expect(seo.description).toBe('D');

    const fallback = pageSeo(obj({ title: 'T' }), eventsSchema, site);
    expect(fallback.description).toBe('A lovely site');
  });

  it('builds the canonical URL from base URL + object URL', () => {
    const seo = pageSeo(obj({ title: 'Summer Fete' }), eventsSchema, site);
    expect(seo.canonical).toBe('https://example.com/events/summer-fete/');
  });

  it('absolutizes the first image field as the OG image', () => {
    const seo = pageSeo(obj({ title: 'T', poster: 'content/events/summer-fete/images/p.webp' }), eventsSchema, site);
    expect(seo.ogImage).toBe('https://example.com/content/events/summer-fete/images/p.webp');

    const none = pageSeo(obj({ title: 'T' }), eventsSchema, site);
    expect(none.ogImage).toBeUndefined();
  });

  it('degrades gracefully with no settings (relative canonical, no site suffix)', () => {
    const seo = pageSeo(obj({ title: 'Summer Fete' }), eventsSchema, {});
    expect(seo.title).toBe('Summer Fete');
    expect(seo.canonical).toBe('/events/summer-fete/');
  });
});

describe('buildSitemap / buildRobots', () => {
  it('lists canonical URLs, XML-escaped', () => {
    const xml = buildSitemap(['https://example.com/a/', 'https://example.com/b/?x=1&y=2']);
    expect(xml).toContain('<loc>https://example.com/a/</loc>');
    expect(xml).toContain('&amp;'); // & escaped
    expect(xml).toMatch(/<urlset[^>]*>/);
  });

  it('points robots at the sitemap when a base URL is set', () => {
    expect(buildRobots({ baseUrl: 'https://example.com' })).toContain('Sitemap: https://example.com/sitemap.xml');
    expect(buildRobots({})).not.toContain('Sitemap:');
    expect(buildRobots({})).toContain('User-agent: *');
  });
});
