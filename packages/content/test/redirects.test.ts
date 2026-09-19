import { describe, expect, it } from 'vitest';
import { redirectStubHtml, aliasUrls, shadowedAliases, Validator } from '../src/index.js';
import type { ContentModel, ContentObject, ContentTypeSchema } from '../src/index.js';

const events: ContentTypeSchema = {
  name: 'events',
  kind: 'collection',
  fields: { title: { type: 'text' } },
};

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
    expect(html).toContain(
      '<meta http-equiv="refresh" content="0; url=/events/summer-fete/">',
    );
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
    expect(aliasUrls(obj('fete', ['fete', 42, 'old', 'old']), events)).toEqual([
      '/events/old/',
    ]);
  });

  it('returns [] when there are no aliases', () => {
    expect(aliasUrls(obj('fete'), events)).toEqual([]);
  });

  it('treats an absolute alias as a literal old URL (a type rename moved the object)', () => {
    expect(aliasUrls(obj('fete', ['/happenings/fete/', 'old']), events)).toEqual([
      '/happenings/fete/',
      '/events/old/',
    ]);
  });

  it('never emits a stub at the object’s own current URL', () => {
    expect(aliasUrls(obj('fete', ['/events/fete/']), events)).toEqual([]);
  });

  it('honours a custom urlPattern', () => {
    const schema: ContentTypeSchema = { ...events, urlPattern: '/e/{slug}.html' };
    expect(aliasUrls(obj('new', ['old']), schema)).toEqual(['/e/old.html']);
  });
});

describe('shadowedAliases', () => {
  const settings: ContentTypeSchema = {
    name: 'settings',
    kind: 'singleton',
    page: false,
    fields: {},
  };
  function page(
    type: string,
    slug: string,
    data: Record<string, unknown> = {},
  ): ContentObject {
    return {
      type,
      kind: 'collection',
      id: `${type}-${slug}`,
      slug,
      path: `content/${type}/${slug}/index.md`,
      data: { id: `${type}-${slug}`, title: slug, public: true, ...data },
      body: '',
      public: data.public !== false,
    };
  }
  function modelOf(
    objects: ContentObject[],
    schemas = new Map([
      ['events', events],
      ['settings', settings],
    ]),
  ): ContentModel {
    return {
      schemas,
      objects,
      byId: new Map(objects.filter((o) => o.id).map((o) => [o.id!, o])),
      byTranslation: new Map(),
      errors: [],
    };
  }

  it('reports a slug alias and an absolute alias that a live page now occupies', () => {
    const renamed = page('events', 'fete', { aliases: ['fayre', '/events/gala/'] });
    const fayre = page('events', 'fayre');
    const gala = page('events', 'gala');
    const found = shadowedAliases(renamed, events, modelOf([renamed, fayre, gala]));
    expect(found).toEqual([
      { alias: 'fayre', url: '/events/fayre/', by: fayre },
      { alias: '/events/gala/', url: '/events/gala/', by: gala },
    ]);
  });

  it('ignores drafts, non-page types, the object itself, and an unclaimed alias', () => {
    const renamed = page('events', 'fete', {
      aliases: ['fayre', '/events/fete/', 'nothing'],
    });
    const draft = page('events', 'fayre', { public: false });
    const config: ContentObject = {
      ...page('settings', 'settings'),
      kind: 'singleton',
      path: 'content/settings/index.md',
    };
    expect(shadowedAliases(renamed, events, modelOf([renamed, draft, config]))).toEqual(
      [],
    );
  });

  it('routes the homepage object to / (it never shadows an alias at its pattern URL)', () => {
    const renamed = page('events', 'fete', { aliases: ['home'] });
    const home = page('events', 'home');
    const config: ContentObject = {
      ...page('settings', 'settings', { homepage: 'events-home' }),
      kind: 'singleton',
      path: 'content/settings/index.md',
    };
    expect(shadowedAliases(renamed, events, modelOf([renamed, home, config]))).toEqual(
      [],
    );
  });

  it('is reported by the validator on the object carrying the alias, with the fix', () => {
    const renamed = page('events', 'fete', { aliases: ['/events/gala/'] });
    const gala = page('events', 'gala', { title: 'Gala Night' });
    const model = modelOf([renamed, gala]);
    const validator = new Validator(model.schemas);
    expect(validator.validateObject(renamed, model)).toEqual({
      valid: false,
      errors: [
        {
          field: 'aliases',
          message:
            'alias "/events/gala/" points at /events/gala/, where the page "Gala Night" (content/events/gala/index.md) now lives — remove the alias',
        },
      ],
    });
    expect(validator.validateObject(gala, model).valid).toBe(true);
  });
});
