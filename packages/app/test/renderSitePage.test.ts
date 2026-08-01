import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadSchemas, assembleContent, type RepoSnapshot } from '@timber/content';
import { renderSitePage } from '../src/preview/renderSitePage.js';
import { AssetStore } from '../src/state/assets.js';
import type { SiteTheme } from '../src/preview/siteTheme.js';

// Render against the real site-template — the default theme the editor ships — so this
// exercises the whole preview path: template resolution, site/nav/seo assembly (the same
// @timber/content helpers the CLI build uses), and theme inlining.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../site-template');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

function fixture(): { model: ReturnType<typeof assembleContent>; theme: SiteTheme } {
  const snapshot: RepoSnapshot = new Map([
    ['config/schemas/pages.yml', read('config/schemas/pages.yml')],
    ['config/schemas/settings.yml', read('config/schemas/settings.yml')],
    ['content/settings/index.md', read('content/settings/index.md')],
    ['content/pages/home/index.md', read('content/pages/home/index.md')],
    ['content/pages/about/index.md', read('content/pages/about/index.md')],
  ]);
  const schemas = loadSchemas(snapshot);
  const model = assembleContent(snapshot, schemas);
  const theme: SiteTheme = {
    templates: new Map([
      ['default.liquid', read('themes/default/templates/default.liquid')],
    ]),
    stylesheets: new Map([['assets/theme.css', read('themes/default/assets/theme.css')]]),
    navigationYml: read('config/navigation.yml'),
    manifest: null,
    objectUrls: [],
  };
  return { model, theme };
}

const home = (model: ReturnType<typeof assembleContent>) =>
  model.objects.find((o) => o.path === 'content/pages/home/index.md')!;

describe('renderSitePage', () => {
  it('renders a page through the site’s own template + theme', async () => {
    const { model, theme } = fixture();
    const object = home(model);
    const html = await renderSitePage({
      model,
      object,
      schema: model.schemas.get(object.type)!,
      data: object.data,
      body: object.body,
      theme,
      assetStore: new AssetStore(),
    });

    // Full page shell from the site's template (not the old placeholder <article>).
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('class="site-header"');
    // The theme is inlined; the unreachable <link href=.../assets/theme.css> is gone.
    expect(html).toContain('<style data-timber-theme>');
    expect(html).not.toContain('assets/theme.css');
    // Nav resolved from navigation.yml through the id index (labels + resolved hrefs).
    expect(html).toContain('>Home</a>');
    expect(html).toContain('>About</a>');
    // Live title in <head>/<h1> and the rendered Markdown body.
    expect(html).toContain('Welcome');
    // The home page body uses the `:timber-logo` shortcode (SPEC §7 → Brand wordmark):
    // it renders the styled wordmark, and the page-level injection puts its self-contained
    // styling (rules + embedded font) in <head>, so the logo works in preview with no theme setup.
    expect(html).toContain(
      '<span class="wordmark"><span class="wordmark__tim">Tim</span>ber</span>',
    );
    expect(html).toContain('@font-face');
    expect(html.indexOf('@font-face')).toBeLessThan(html.indexOf('</head>'));
  });

  it('reflects live front-matter edits, not the stored copy', async () => {
    const { model, theme } = fixture();
    const object = home(model);
    const html = await renderSitePage({
      model,
      object,
      schema: model.schemas.get(object.type)!,
      data: { ...object.data, title: 'Edited In Preview' },
      body: object.body,
      theme,
      assetStore: new AssetStore(),
    });
    expect(html).toContain('Edited In Preview');
  });

  it('renders the language switcher, hreflang, and <html lang> for a translated page (preview ≡ build)', async () => {
    // An inline two-language site, rendered through the shipped default theme, so the
    // preview exercises the same i18n path the CLI build does (SPEC §5 → Multilingual).
    const snapshot: RepoSnapshot = new Map([
      [
        'config/schemas/posts.yml',
        'kind: collection\nhasBody: true\nfields:\n  title:\n    type: text\n',
      ],
      ['config/schemas/settings.yml', read('config/schemas/settings.yml')],
      [
        'content/settings/index.md',
        '---\ntitle: Multi\nbaseUrl: https://ex.test\nlanguages:\n  - en\n  - fr\ndefaultLanguage: en\n---\n',
      ],
      [
        'content/posts/en/hi/index.md',
        '---\nid: HI-EN\ntitle: Hi\ntranslationKey: T\npublic: true\n---\nHi.\n',
      ],
      [
        'content/posts/fr/salut/index.md',
        '---\nid: HI-FR\ntitle: Salut\ntranslationKey: T\npublic: true\n---\nSalut.\n',
      ],
    ]);
    const model = assembleContent(snapshot, loadSchemas(snapshot));
    const theme: SiteTheme = {
      templates: new Map([
        ['default.liquid', read('themes/default/templates/default.liquid')],
      ]),
      stylesheets: new Map([
        ['assets/theme.css', read('themes/default/assets/theme.css')],
      ]),
      navigationYml: null,
      manifest: null,
      objectUrls: [],
    };
    const en = model.objects.find((o) => o.path === 'content/posts/en/hi/index.md')!;
    const html = await renderSitePage({
      model,
      object: en,
      schema: model.schemas.get('posts')!,
      data: en.data,
      body: en.body,
      theme,
      assetStore: new AssetStore(),
    });

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('hreflang="fr" href="https://ex.test/fr/posts/salut/"');
    expect(html).toContain('hreflang="x-default" href="https://ex.test/en/posts/hi/"');
    // Switcher links both siblings, marking the current language.
    expect(html).toContain('href="/fr/posts/salut/"');
    expect(html).toContain('aria-current="true"');
  });

  it('throws a helpful error when no template resolves', async () => {
    const { model } = fixture();
    const object = home(model);
    const empty: SiteTheme = {
      templates: new Map(),
      stylesheets: new Map(),
      navigationYml: null,
      manifest: null,
      objectUrls: [],
    };
    await expect(
      renderSitePage({
        model,
        object,
        schema: model.schemas.get(object.type)!,
        data: object.data,
        body: object.body,
        theme: empty,
        assetStore: new AssetStore(),
      }),
    ).rejects.toThrow(/default\.liquid/);
  });

  it('previews an imported-theme template using {% seo %} + Jekyll filters (preview ≡ build)', async () => {
    // An adopted Jekyll theme's template still calls `{% seo %}` / `date_to_xmlschema`; the
    // preview must register the same compat layer the CLI build does, or it would throw
    // "tag seo not found". This proves the preview engine has them (SPEC §2 → Tier A).
    const { model } = fixture();
    const object = home(model);
    const theme: SiteTheme = {
      templates: new Map([
        [
          'default.liquid',
          '<!doctype html><html><head>{% seo %}</head><body>' +
            '<time datetime="{{ page.date | date_to_xmlschema }}">d</time>' +
            '{% block main %}{{ content }}{% endblock %}</body></html>',
        ],
      ]),
      stylesheets: new Map(),
      navigationYml: null,
      manifest: null,
      objectUrls: [],
    };
    const html = await renderSitePage({
      model,
      object,
      schema: model.schemas.get(object.type)!,
      data: { ...object.data, date: '2026-05-02T09:00:00Z' },
      body: object.body,
      theme,
      assetStore: new AssetStore(),
    });
    expect(html).toContain('<title>'); // {% seo %} emitted (would throw if unregistered)
    expect(html).toContain('datetime="2026-05-02T09:00:00.000Z"'); // date_to_xmlschema
    expect(html).not.toContain('{%'); // no unresolved Liquid
  });

  it('inlines a stylesheet at a non-conventional path (imported theme, e.g. assets/css/style.css)', async () => {
    // Minima links its CSS at assets/css/style.css, not assets/theme.css. The preview must
    // inline whichever stylesheet the page links, base-path-aware.
    const { model } = fixture();
    const object = home(model);
    const theme: SiteTheme = {
      templates: new Map([
        [
          'default.liquid',
          '<!doctype html><html><head>' +
            '<link rel="stylesheet" href="{{ site.basePath }}/assets/css/style.css">' +
            '</head><body>{% block main %}{{ content }}{% endblock %}</body></html>',
        ],
      ]),
      stylesheets: new Map([['assets/css/style.css', '.site-header{color:teal}']]),
      navigationYml: null,
      manifest: null,
      objectUrls: [],
    };
    const html = await renderSitePage({
      model,
      object,
      schema: model.schemas.get(object.type)!,
      data: object.data,
      body: object.body,
      theme,
      assetStore: new AssetStore(),
    });
    expect(html).toContain('<style data-timber-theme>.site-header{color:teal}</style>');
    expect(html).not.toContain('<link'); // the unreachable link was replaced
  });

  it('previews an imported Eleventy theme with the flat data cascade (theme.json manifest → preview ≡ build)', async () => {
    // An Eleventy theme reads bare {{ title }} + {{ metadata.* }} (its _data globals), not
    // page.*. The manifest tells the preview to render with flattenData + the globals, so it
    // matches the CLI build (SPEC §2 → Tier A).
    const { model } = fixture();
    const object = home(model);
    const theme: SiteTheme = {
      templates: new Map([
        [
          'default.liquid',
          '<!doctype html><html><head><title>{{ title }}</title></head>' +
            '<body><h1>{{ title }}</h1><p>by {{ metadata.author }}</p>{{ content }}</body></html>',
        ],
      ]),
      stylesheets: new Map(),
      navigationYml: null,
      manifest: { engine: 'eleventy', data: { metadata: { author: 'Ada' } } },
      objectUrls: [],
    };
    const html = await renderSitePage({
      model,
      object,
      schema: model.schemas.get(object.type)!,
      data: { ...object.data, title: 'Welcome Home' },
      body: object.body,
      theme,
      assetStore: new AssetStore(),
    });
    expect(html).toContain('<h1>Welcome Home</h1>'); // bare {{ title }} via flattenData
    expect(html).toContain('<title>Welcome Home</title>');
    expect(html).toContain('<p>by Ada</p>'); // {{ metadata.author }} from manifest globals
    expect(html).not.toContain('{{');
  });

  it('previews a paginated listing’s first page through the shipped theme (SPEC §13)', async () => {
    // A listing page declaring `paginate` front matter renders with a `paginator`, exactly
    // as the CLI build's first page does — same `paginateObject`/`paginatedSeo` helpers — so
    // the author sees the real listing while editing (preview ≡ build).
    const snapshot: RepoSnapshot = new Map([
      ['config/schemas/pages.yml', read('config/schemas/pages.yml')],
      [
        'config/schemas/posts.yml',
        'kind: collection\nhasBody: true\nfields:\n  title:\n    type: text\n  description:\n    type: text\n  date:\n    type: date\n',
      ],
      ['config/schemas/settings.yml', read('config/schemas/settings.yml')],
      [
        'content/settings/index.md',
        '---\ntitle: Blogged\nbaseUrl: https://ex.test\nactiveTheme: default\n---\n',
      ],
      [
        'content/pages/blog/index.md',
        // No `paginate` on disk: the test supplies it as a *live* edit below, proving a
        // just-typed block paginates the preview immediately.
        '---\nid: PAGE-BLOG\ntitle: Blog\npublic: true\n---\nLatest writing.\n',
      ],
      [
        'content/posts/one/index.md',
        '---\nid: P1\ntitle: Post One\ndescription: First.\ndate: 2026-01-01\npublic: true\n---\nOne.\n',
      ],
      [
        'content/posts/two/index.md',
        '---\nid: P2\ntitle: Post Two\ndescription: Second.\ndate: 2026-02-01\npublic: true\n---\nTwo.\n',
      ],
      [
        'content/posts/three/index.md',
        '---\nid: P3\ntitle: Post Three\ndate: 2026-03-01\npublic: true\n---\nThree.\n',
      ],
    ]);
    const model = assembleContent(snapshot, loadSchemas(snapshot));
    const theme: SiteTheme = {
      templates: new Map([
        ['default.liquid', read('themes/default/templates/default.liquid')],
        ['pagination.liquid', read('themes/default/templates/pagination.liquid')],
      ]),
      stylesheets: new Map([
        ['assets/theme.css', read('themes/default/assets/theme.css')],
      ]),
      navigationYml: null,
      manifest: null,
      objectUrls: [],
    };
    const blog = model.objects.find((o) => o.path === 'content/pages/blog/index.md')!;
    const html = await renderSitePage({
      model,
      object: blog,
      schema: model.schemas.get('pages')!,
      data: { ...blog.data, paginate: { collection: 'posts', size: 2 } },
      body: blog.body,
      theme,
      assetStore: new AssetStore(),
    });

    // The listing itself, then the newest two posts (collections sort most-recent-first).
    expect(html).toContain('<h1>Blog</h1>');
    expect(html).toContain('Latest writing.');
    expect(html).toContain('>Post Three</a>');
    expect(html).toContain('>Post Two</a>');
    expect(html).not.toContain('Post One');
    // The listing shows each post's own opening (SPEC §6), not its meta description —
    // and the preview must agree with the build about that.
    expect(html).toContain('<div class="listing__excerpt"><p>Two.</p>');
    expect(html).not.toContain('Second.');

    // The pager, rendered through the theme's own `{% render 'pagination' %}` partial.
    expect(html).toContain('<nav class="pagination" aria-label="Pagination">');
    expect(html).toContain('href="/pages/blog/page/2/"');
    expect(html).toContain('aria-current="page">1</span>');
    expect(html).toContain(
      '<link rel="next" href="https://ex.test/pages/blog/page/2/" />',
    );
    expect(html).not.toContain('rel="prev"');
    expect(html).not.toContain('{{');
  });

  it('leaves an ordinary page with no paginator, so listing markup is a no-op', async () => {
    const { model, theme } = fixture();
    const object = home(model);
    const html = await renderSitePage({
      model,
      object,
      schema: model.schemas.get(object.type)!,
      data: object.data,
      body: object.body,
      theme,
      assetStore: new AssetStore(),
    });
    expect(html).not.toContain('class="listing"');
    expect(html).not.toContain('class="pagination"');
  });
});

/**
 * The preview frame has no origin it can fetch the repo from, so every image reference has
 * to become a blob URL — which means mapping the reference back to the **repo path** the
 * AssetStore keys on. A page can carry three different shapes of reference, and getting
 * any of them wrong shows the author a broken image in a preview of a page that is fine.
 */
describe('renderSitePage image references', () => {
  /** A snapshot with a colocated image in a post body and a site-wide asset in settings. */
  function imageFixture(): {
    model: ReturnType<typeof assembleContent>;
    theme: SiteTheme;
  } {
    const snapshot: RepoSnapshot = new Map([
      [
        'config/schemas/settings.yml',
        'kind: singleton\npage: false\nhasBody: false\nfields:\n  title:\n    type: text\n  baseUrl:\n    type: text\n  logo:\n    type: image\n',
      ],
      [
        'config/schemas/posts.yml',
        'kind: collection\nfields:\n  title:\n    type: text\n  date:\n    type: date\n',
      ],
      [
        'content/settings/index.md',
        '---\ntitle: S\nbaseUrl: https://example.test\nlogo: /assets/logo.png\n---\n',
      ],
      [
        'content/posts/hello/index.md',
        '---\nid: P1\ntitle: Hello\ndate: 2026-01-01\npublic: true\n---\n\n![Alt](photo.jpg)\n',
      ],
    ]);
    const schemas = loadSchemas(snapshot);
    const model = assembleContent(snapshot, schemas);
    const theme: SiteTheme = {
      templates: new Map([
        [
          'default.liquid',
          '<img src="{{ site.logo | relative_url }}" />{{ content }}' +
            '{% for p in collections.posts %}{{ p.excerpt }}{% endfor %}',
        ],
      ]),
      stylesheets: new Map(),
      navigationYml: '',
      manifest: null,
      objectUrls: [],
    };
    return { model, theme };
  }

  /** Render `target` and report every repo path the preview asked the store to load. */
  async function requestedPaths(target: string): Promise<string[]> {
    const { model, theme } = imageFixture();
    const object = model.objects.find((o) => o.path === target)!;
    const asked: string[] = [];
    const store = new AssetStore(async (p: string) => {
      asked.push(p);
      return undefined;
    });
    await renderSitePage({
      model,
      object,
      schema: model.schemas.get(object.type)!,
      data: object.data,
      body: object.body,
      theme,
      assetStore: store,
    });
    return asked.sort();
  }

  it('resolves a colocated image written as a bare filename', async () => {
    // `![Alt](photo.jpg)` only means anything relative to the bundle it was written in.
    const asked = await requestedPaths('content/posts/hello/index.md');
    expect(asked).toContain('content/posts/hello/photo.jpg');
  });

  it('resolves a site-wide asset referenced from the site root', async () => {
    // `/assets/logo.png` is a repo path once the leading slash comes off — but it never
    // matched while the check required the reference to *start* with `assets/`.
    const asked = await requestedPaths('content/posts/hello/index.md');
    expect(asked).toContain('assets/logo.png');
  });

  it("resolves another object's colocated image carried by a listing excerpt", async () => {
    // An excerpt arrives as `/posts/hello/photo.jpg` — a site URL, not a repo path. Only
    // the model can say which bundle that URL came from.
    const asked = await requestedPaths('content/settings/index.md');
    expect(asked).toContain('content/posts/hello/photo.jpg');
  });

  it('leaves references it does not own alone', async () => {
    const asked = await requestedPaths('content/posts/hello/index.md');
    expect(asked.some((p) => p.includes('://') || p.startsWith('//'))).toBe(false);
  });
});
