import { describe, expect, it } from 'vitest';
import { redirectStubHtml, aliasUrls } from '../src/index.js';
import type { ContentObject, ContentTypeSchema } from '../src/index.js';

const events: ContentTypeSchema = { name: 'events', kind: 'collection', fields: { title: { type: 'text' } } };

function obj(slug: string, aliases?: unknown): ContentObject {
  return {
    type: 'events',
    kind: 'collection',
    id: 'e1',
    slug,
    path: `content/events/${slug}/index.md`,
    data: { id: 'e1', title: 'Fete', ...(aliases !== undefined ? { aliases } : {}) },
    body: '',
    public: true,
  };
}

describe('redirectStubHtml', () => {
  it('meta-refreshes and canonicalises to the target URL', () => {
    const html = redirectStubHtml('/events/summer-fete/');
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/events/summer-fete/">');
    expect(html).toContain('<link rel="canonical" href="/events/summer-fete/">');
    expect(html).toContain('href="/events/summer-fete/"');
  });

  it('HTML-escapes the target URL (a hostile slug cannot inject markup)', () => {
    const html = redirectStubHtml('/events/x"><script>alert(1)</script>/');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;&gt;'); // the attribute-breakout `">` is neutralised
  });
});

describe('aliasUrls', () => {
  it('maps each alias slug to its old URL via the type pattern', () => {
    expect(aliasUrls(obj('summer-fete', ['fete', 'old-fete']), events)).toEqual([
      '/events/fete/',
      '/events/old-fete/',
    ]);
  });

  it('ignores non-string aliases, the current slug, and duplicates', () => {
    expect(aliasUrls(obj('fete', ['fete', 42, 'old', 'old']), events)).toEqual(['/events/old/']);
  });

  it('returns [] when there are no aliases', () => {
    expect(aliasUrls(obj('fete'), events)).toEqual([]);
  });

  it('honours a custom urlPattern', () => {
    const schema: ContentTypeSchema = { ...events, urlPattern: '/e/{slug}.html' };
    expect(aliasUrls(obj('new', ['old']), schema)).toEqual(['/e/old.html']);
  });
});
