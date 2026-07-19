import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { renderPage } from '@timber/generator';
import {
  siteContext,
  pageSeo,
  urlFor,
  assembleCollections,
  withCollectionAliases,
  type ContentObject,
  type ContentTypeSchema,
} from '@timber/content';
import { registerJekyllCompat } from '../src/register.js';
import { importJekyllTheme } from '../src/importTheme.js';

/**
 * End-to-end proof: the REAL Minima `_layouts` + `_includes` (vendored under
 * test/fixtures/minima, MIT) render real content through Timber's actual pipeline —
 * `renderPage` with the `extend: registerJekyllCompat` seam, fed by Timber's own content
 * APIs (siteContext / assembleCollections / pageSeo / urlFor / withCollectionAliases).
 */

const here = dirname(fileURLToPath(import.meta.url));
const MINIMA = join(here, 'fixtures', 'minima');

// ── A tiny content model, the shape Timber's own APIs consume ──────────────────────────
const schemas = new Map<string, ContentTypeSchema>([
  [
    'site-settings',
    { name: 'site-settings', kind: 'singleton', page: false, fields: {} },
  ],
  [
    'posts',
    {
      name: 'posts',
      kind: 'collection',
      fields: {
        title: { type: 'text' },
        date: { type: 'datetime' },
      },
    },
  ],
  ['pages', { name: 'pages', kind: 'collection', fields: { title: { type: 'text' } } }],
]);

const settings: ContentObject = {
  type: 'site-settings',
  kind: 'singleton',
  slug: 'site-settings',
  path: 'content/site-settings/index.md',
  body: '',
  public: true,
  data: {
    title: 'Larch & Pine',
    description: 'Field notes on trees and timber.',
    baseUrl: 'https://example.github.io/mysite',
    author: { name: 'A. Woodward', email: 'a@example.com' },
    minima: {
      date_format: '%b %-d, %Y',
      social_links: [
        { title: 'GitHub', icon: 'github', url: 'https://github.com/example' },
      ],
    },
  },
};

function obj(
  o: Partial<ContentObject> & Pick<ContentObject, 'type' | 'slug' | 'data' | 'body'>,
): ContentObject {
  return {
    kind: 'collection',
    id: `${o.type}-${o.slug}`,
    path: `content/${o.type}/${o.slug}/index.md`,
    public: o.data.public === true,
    ...o,
  } as ContentObject;
}

const posts = [
  obj({
    type: 'posts',
    slug: 'why-larch',
    body: '## The short of it\n\nLarch is **naturally rot-resistant**.',
    data: {
      title: 'Why Larch Outlasts the Weather',
      date: '2026-05-02T09:00:00Z',
      public: true,
    },
  }),
  obj({
    type: 'posts',
    slug: 'first-plane',
    body: 'A hand plane is _mostly_ setup.',
    data: {
      title: 'Setting Up Your First Hand Plane',
      date: '2026-06-18T09:00:00Z',
      public: true,
    },
  }),
];
const home = obj({
  type: 'pages',
  slug: 'home',
  body: 'Welcome — a small workshop journal.',
  data: { title: 'Larch & Pine', list_title: 'Latest notes', public: true },
});
home.id = 'home';
const about = obj({
  type: 'pages',
  slug: 'about',
  body: 'Woodworker and tree nerd.',
  data: { title: 'About', public: true },
});

const model = { objects: [settings, ...posts, home, about], schemas };
const effectiveUrl = (o: ContentObject, s: ContentTypeSchema): string =>
  o.id === 'home' ? '/' : urlFor(o, s);

// ── Render ─────────────────────────────────────────────────────────────────────────────
let templates: Record<string, string>;
let site: ReturnType<typeof siteContext>;
let collections: ReturnType<typeof assembleCollections>;

async function readDir(sub: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of await readdir(join(MINIMA, sub))) {
    if (file.endsWith('.html'))
      out[file.replace(/\.html$/, '')] = await readFile(join(MINIMA, sub, file), 'utf8');
  }
  return out;
}

beforeAll(async () => {
  ({ templates } = importJekyllTheme(
    { ...(await readDir('_layouts')), ...(await readDir('_includes')) },
    'base',
  ));
  site = siteContext(settings);
  collections = assembleCollections(model, effectiveUrl);
  for (const entry of collections.pages ?? []) entry.path = entry.url; // header nav's site.pages | map:"path"
  site = withCollectionAliases(site, collections, '2026-07-19T00:00:00.000Z');
});

async function renderOne(object: ContentObject, entry: string): Promise<string> {
  const schema = schemas.get(object.type)!;
  const url = effectiveUrl(object, schema);
  const seo = pageSeo(object, schema, site);
  if (object.id === 'home') seo.canonical = `${site.baseUrl}/`;
  return renderPage({
    markdown: `---\n${stringify(object.data)}---\n${object.body}`,
    template: templates[entry]!,
    templates,
    site,
    collections,
    seo,
    url,
    collection: object.type,
    extend: registerJekyllCompat,
  });
}

describe('Minima renders through Timber (renderPage + extend seam)', () => {
  it('home lists posts with base-pathed links (relative_url) and a nav', async () => {
    const html = await renderOne(home, 'home');
    expect(html).toContain('Why Larch Outlasts the Weather');
    expect(html).toContain('Setting Up Your First Hand Plane');
    expect(html).toContain('href="/mysite/posts/why-larch/"');
    expect(html).toContain('href="/mysite/assets/css/style.css"'); // stylesheet, base-pathed
    expect(html).toContain('/mysite/pages/about/'); // site.pages nav
  });

  it("emits {% seo %} <title> from Timber's seo bag without double-escaping", async () => {
    const html = await renderOne(home, 'home');
    expect(html).toContain('<title>');
    expect(html).toContain('Larch &amp; Pine');
    expect(html).not.toContain('&amp;amp;');
  });

  it('post renders strftime date, ISO datetime, Markdown body, and page.url self-link', async () => {
    const html = await renderOne(posts[0]!, 'post');
    expect(html).toContain('May 2, 2026'); // %b %-d, %Y
    expect(html).toContain('datetime="2026-05-02T09:00:00.000Z"'); // date_to_xmlschema
    expect(html).toContain('<strong>naturally rot-resistant</strong>'); // markdown → html
    expect(html).toContain('href="/mysite/posts/why-larch/"'); // page.url | relative_url
  });

  it('leaves no unresolved Liquid in any rendered page', async () => {
    for (const [o, t] of [
      [home, 'home'],
      [posts[0]!, 'post'],
      [about, 'page'],
    ] as const) {
      const html = await renderOne(o, t);
      expect(html).not.toContain('{%');
      expect(html).not.toContain('{{');
    }
  });
});
