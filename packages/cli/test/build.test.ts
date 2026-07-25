import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderPage } from '@timber/generator';
import {
  assembleCollections,
  assembleContent,
  loadSchemas,
  pageSeo,
  siteContext,
  urlFor,
} from '@timber/content';
import { buildSite, BuildError } from '../src/build.node.js';
import { buildSnapshotFromDir } from '../src/snapshot.node.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteFixture = join(here, 'fixtures', 'site');
const invalidFixture = join(here, 'fixtures', 'site-invalid');
const i18nFixture = join(here, 'fixtures', 'site-i18n');
const themedFixture = join(here, 'fixtures', 'site-themed');
const eleventyFixture = join(here, 'fixtures', 'site-eleventy');
const paginatedFixture = join(here, 'fixtures', 'site-paginated');
/** The real scaffold every new site starts from — built as-is by the theme test below. */
const siteTemplate = join(here, '..', '..', '..', 'site-template');

async function exists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false);
}

describe('buildSite', () => {
  let out: string;
  beforeEach(async () => {
    out = await mkdtemp(join(tmpdir(), 'timber-build-'));
  });
  afterEach(() => undefined);

  it('renders public objects to <url>/index.html via their type template', async () => {
    const result = await buildSite(siteFixture, out);

    expect(result.pages).toBe(4); // hello, fete, note1, home
    expect(result.drafts).toBe(1); // secret

    const hello = await readFile(join(out, 'pages/hello/index.html'), 'utf8');
    expect(hello).toContain('class="pages"');
    expect(hello).toContain('<h1>Hello</h1>');
    expect(hello).toContain('<strong>Hello</strong>'); // markdown body rendered

    const fete = await readFile(join(out, 'events/fete/index.html'), 'utf8');
    expect(fete).toContain('class="events"'); // used events.liquid, not default
    expect(fete).toContain('2026-08-15');
  });

  it('exposes per-type collections to templates for listing loops (SPEC §6)', async () => {
    await buildSite(siteFixture, out);

    // pages.liquid loops `collections.events`; the public event renders with its
    // resolved URL and date field — proving collections reach templates in the build.
    const hello = await readFile(join(out, 'pages/hello/index.html'), 'utf8');
    expect(hello).toContain(
      '<li><a href="/events/fete/">Summer Fete</a> 2026-08-15</li>',
    );
  });

  it('omits drafts from the build', async () => {
    await buildSite(siteFixture, out);
    expect(await exists(join(out, 'pages/secret/index.html'))).toBe(false);
  });

  it('emits a redirect stub at each alias URL pointing to the current URL (SPEC §5)', async () => {
    const result = await buildSite(siteFixture, out);
    expect(result.redirects).toBe(1);

    // fete declares alias `summer-fayre`; its old URL redirects to the current one.
    const stub = await readFile(join(out, 'events/summer-fayre/index.html'), 'utf8');
    expect(stub).toContain('<meta http-equiv="refresh" content="0; url=/events/fete/">');
    expect(stub).toContain('<link rel="canonical" href="/events/fete/">');
    // The real page still exists at the current URL.
    expect(await exists(join(out, 'events/fete/index.html'))).toBe(true);
  });

  it('falls back to templates/default.liquid when no <type>.liquid exists', async () => {
    await buildSite(siteFixture, out);
    const note = await readFile(join(out, 'notes/note1/index.html'), 'utf8');
    expect(note).toContain('class="default"');
    expect(note).toContain('<h1>A Note</h1>');
  });

  it('resolves {% render %} partials from the templates dir (SPEC §6 snippets)', async () => {
    // pages.liquid does `{% render 'footer' %}`; templates/footer.liquid must resolve
    // through the in-memory map the build assembles — proving reuse across template files.
    await buildSite(siteFixture, out);
    const hello = await readFile(join(out, 'pages/hello/index.html'), 'utf8');
    expect(hello).toContain('<footer class="from-partial">shared footer</footer>');
  });

  it('copies site-wide and colocated assets', async () => {
    await buildSite(siteFixture, out);
    expect(await exists(join(out, 'assets/site.css'))).toBe(true);
    // colocated bundle asset ships next to its page
    const src = await readFile(
      join(siteFixture, 'content/events/fete/images/pixel.webp'),
    );
    const copied = await readFile(join(out, 'events/fete/images/pixel.webp'));
    expect(Buffer.compare(src, copied)).toBe(0);
  });

  it('fails the build when a public object is invalid (never deploy broken content)', async () => {
    await expect(buildSite(invalidFixture, out)).rejects.toBeInstanceOf(BuildError);
  });

  it('reads the settings singleton for site context but never renders it as a page', async () => {
    await buildSite(siteFixture, out);
    // page: false → no HTML emitted for the settings singleton
    expect(await exists(join(out, 'settings/index.html'))).toBe(false);

    // ...but its data drives per-page SEO (title suffix, canonical) in the <head>.
    const hello = await readFile(join(out, 'pages/hello/index.html'), 'utf8');
    expect(hello).toContain('<title>Hello · Fixture Site</title>');
    expect(hello).toContain(
      '<link rel="canonical" href="https://fixture.example/pages/hello/">',
    );
  });

  it('emits sitemap.xml and robots.txt with canonical URLs', async () => {
    await buildSite(siteFixture, out);

    const sitemap = await readFile(join(out, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://fixture.example/pages/hello/</loc>');
    expect(sitemap).toContain('<loc>https://fixture.example/events/fete/</loc>');
    expect(sitemap).toContain('<loc>https://fixture.example/</loc>'); // homepage at root
    expect(sitemap).not.toContain('secret'); // drafts excluded

    const robots = await readFile(join(out, 'robots.txt'), 'utf8');
    expect(robots).toContain('Sitemap: https://fixture.example/sitemap.xml');
  });

  it('renders the homepage at the domain root, not its /type/slug/ URL', async () => {
    await buildSite(siteFixture, out);
    const root = await readFile(join(out, 'index.html'), 'utf8');
    expect(root).toContain('<h1>Home</h1>');
    expect(root).toContain('<link rel="canonical" href="https://fixture.example/">');
    // the homepage object does NOT also appear at /pages/home/
    expect(await exists(join(out, 'pages/home/index.html'))).toBe(false);
  });

  it('injects the manual navigation into templates as site.nav', async () => {
    await buildSite(siteFixture, out);
    // note1 uses the default template, which renders the nav.
    const note = await readFile(join(out, 'notes/note1/index.html'), 'utf8');
    expect(note).toContain('<a href="/">Home</a>'); // ref resolved to homepage-at-root
    expect(note).toContain('<a href="/about/">About</a>'); // explicit url
  });

  it('routes each language variant to a language-prefixed URL (SPEC §5 → Multilingual)', async () => {
    const result = await buildSite(i18nFixture, out);
    expect(result.pages).toBe(2);

    const en = await readFile(join(out, 'en/posts/hello/index.html'), 'utf8');
    expect(en).toContain('<h1>Hello</h1>');
    expect(en).toContain(
      '<link rel="canonical" href="https://i18n.example/en/posts/hello/">',
    );

    const fr = await readFile(join(out, 'fr/posts/bonjour/index.html'), 'utf8');
    expect(fr).toContain('<h1>Bonjour</h1>');
    expect(fr).toContain(
      '<link rel="canonical" href="https://i18n.example/fr/posts/bonjour/">',
    );

    // The unprefixed URLs must NOT exist — every language is prefixed, uniformly.
    expect(await exists(join(out, 'posts/hello/index.html'))).toBe(false);
  });

  it('emits per-language sitemap entries for translated content', async () => {
    await buildSite(i18nFixture, out);
    const sitemap = await readFile(join(out, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://i18n.example/en/posts/hello/</loc>');
    expect(sitemap).toContain('<loc>https://i18n.example/fr/posts/bonjour/</loc>');
  });

  it('emits <html lang>, hreflang alternates, and a language switcher (Phase 2)', async () => {
    await buildSite(i18nFixture, out);
    const en = await readFile(join(out, 'en/posts/hello/index.html'), 'utf8');

    // <html lang> reflects the page's resolved language.
    expect(en).toContain('<html lang="en">');

    // hreflang alternates for both languages + x-default (absolute against baseUrl).
    expect(en).toContain(
      '<link rel="alternate" hreflang="en" href="https://i18n.example/en/posts/hello/">',
    );
    expect(en).toContain(
      '<link rel="alternate" hreflang="fr" href="https://i18n.example/fr/posts/bonjour/">',
    );
    expect(en).toContain(
      '<link rel="alternate" hreflang="x-default" href="https://i18n.example/en/posts/hello/">',
    );

    // A language switcher linking each sibling, marking the current language.
    expect(en).toContain('<a href="/en/posts/hello/" aria-current="true">en</a>');
    expect(en).toContain('<a href="/fr/posts/bonjour/">fr</a>');
  });

  it('renders through the active theme folder and merges its assets into /assets (SPEC §13)', async () => {
    const result = await buildSite(themedFixture, out);
    expect(result.pages).toBe(1);

    // The page renders through themes/acme/templates/default.liquid, not a root template.
    const home = await readFile(join(out, 'pages/home/index.html'), 'utf8');
    expect(home).toContain('class="acme"');
    expect(home).toContain('<h1>Home</h1>');
    expect(home).toContain('<strong>acme</strong>'); // markdown body rendered

    // The theme's SCSS compiled (resolving @import from the theme's own _sass) and published
    // under /assets/theme.css — the URL the theme's <link> references.
    const css = await readFile(join(out, 'assets/theme.css'), 'utf8');
    expect(css).toContain('color:red'); // $c from themes/acme/assets/_sass/_vars.scss (compressed)
    // Partials are consumed, never emitted.
    expect(await exists(join(out, 'assets/_sass/_vars.scss'))).toBe(false);
    expect(await exists(join(out, 'assets/theme.scss'))).toBe(false);

    // A site-level upload (no theme copy) publishes as-is.
    expect((await readFile(join(out, 'assets/logo.txt'), 'utf8')).trim()).toBe(
      'site-logo',
    );
    // On a theme↔site path clash, the site's own upload wins (switching themes never
    // disturbs a site's uploads).
    expect((await readFile(join(out, 'assets/shared.txt'), 'utf8')).trim()).toBe(
      'from-site',
    );
  });

  it('renders an imported Eleventy theme with the flat data cascade (theme.json manifest)', async () => {
    const result = await buildSite(eleventyFixture, out);
    expect(result.pages).toBe(1);

    const home = await readFile(join(out, 'pages/home/index.html'), 'utf8');
    // Bare {{ title }} resolves — the manifest's engine=eleventy turned on flattenData.
    expect(home).toContain('<h1>Home Page</h1>');
    expect(home).toContain('<title>Home Page · Eleven Site</title>'); // + site.title from settings
    // {{ metadata.author }} comes from the manifest's `data` globals (Eleventy _data/*.json).
    expect(home).toContain('<p class="byline">by Ada Lovelace</p>');
    // {{ content }} still renders the markdown body.
    expect(home).toContain('<strong>Eleventy</strong>');
  });

  it('build output equals renderPage output for the same object (preview ≡ build)', async () => {
    await buildSite(siteFixture, out);
    const built = await readFile(join(out, 'pages/hello/index.html'), 'utf8');

    // The "browser preview" path: same renderPage, same inputs the build uses
    // (including the derived site + seo context).
    const snapshot = await buildSnapshotFromDir(siteFixture);
    const schemas = loadSchemas(snapshot);
    const model = assembleContent(snapshot, schemas);
    const settings = model.objects.find((o) => schemas.get(o.type)?.page === false);
    const site = siteContext(settings);
    const homepageId = typeof site.homepage === 'string' ? site.homepage : undefined;
    const collections = assembleCollections(model, (o, s) =>
      homepageId && o.id === homepageId ? '/' : urlFor(o, s),
    );
    const hello = model.objects.find((o) => o.path === 'content/pages/hello/index.md')!;
    const url = urlFor(hello, schemas.get('pages')!);
    const seo = pageSeo(hello, schemas.get('pages')!, site, { url });

    const markdown = await readFile(
      join(siteFixture, 'content/pages/hello/index.md'),
      'utf8',
    );
    const template = await readFile(join(siteFixture, 'templates/pages.liquid'), 'utf8');
    // The preview supplies the same bare-name template map the build assembles, so a
    // template using `{% render %}`/`{% layout %}` resolves identically (SPEC §6).
    const templates = {
      default: await readFile(join(siteFixture, 'templates/default.liquid'), 'utf8'),
      pages: template,
      events: await readFile(join(siteFixture, 'templates/events.liquid'), 'utf8'),
      footer: await readFile(join(siteFixture, 'templates/footer.liquid'), 'utf8'),
    };
    const preview = await renderPage({
      markdown,
      template,
      templates,
      site,
      collections,
      seo,
      url,
    });

    expect(built).toBe(preview);
  });

  describe('paginated listings (SPEC §13)', () => {
    it('renders a `paginate` page as N pages: page 1 at its URL, the rest under page/<n>/', async () => {
      const result = await buildSite(paginatedFixture, out);
      // blog (3 pages: 5 posts at size 2) + notes (1 empty page) + 5 posts
      expect(result.pages).toBe(9);

      expect(await exists(join(out, 'pages/blog/index.html'))).toBe(true);
      expect(await exists(join(out, 'pages/blog/page/2/index.html'))).toBe(true);
      expect(await exists(join(out, 'pages/blog/page/3/index.html'))).toBe(true);
      // No page 4, and no `page/1/` duplicate of the listing itself.
      expect(await exists(join(out, 'pages/blog/page/4/index.html'))).toBe(false);
      expect(await exists(join(out, 'pages/blog/page/1/index.html'))).toBe(false);
    });

    it('slices the collection across pages in its assembled (most-recent-first) order', async () => {
      await buildSite(paginatedFixture, out);

      const one = await readFile(join(out, 'pages/blog/index.html'), 'utf8');
      expect(one).toContain('<li><a href="/posts/post-5/">Post 5</a></li>');
      expect(one).toContain('<li><a href="/posts/post-4/">Post 4</a></li>');
      expect(one).not.toContain('Post 3');
      expect(one).toContain('<p class="count">1/3 of 5</p>');

      const three = await readFile(join(out, 'pages/blog/page/3/index.html'), 'utf8');
      expect(three).toContain('<li><a href="/posts/post-1/">Post 1</a></li>');
      expect(three).not.toContain('Post 2');
      expect(three).toContain('<p class="count">3/3 of 5</p>');
    });

    it('renders the listing page body and title on every page', async () => {
      await buildSite(paginatedFixture, out);
      for (const path of ['pages/blog/index.html', 'pages/blog/page/2/index.html']) {
        const html = await readFile(join(out, path), 'utf8');
        expect(html).toContain('<h1>Blog</h1>');
        expect(html).toContain('Latest writing.');
      }
    });

    it('gives each page its own canonical, page.url, and title (pages 2+ suffixed)', async () => {
      await buildSite(paginatedFixture, out);

      const one = await readFile(join(out, 'pages/blog/index.html'), 'utf8');
      expect(one).toContain('<title>Blog · Paginated Fixture</title>');
      expect(one).toContain(
        '<link rel="canonical" href="https://fixture.example/pages/blog/">',
      );
      expect(one).toContain('<p class="self">/pages/blog/</p>');

      const two = await readFile(join(out, 'pages/blog/page/2/index.html'), 'utf8');
      expect(two).toContain('<title>Blog · Page 2 of 3 · Paginated Fixture</title>');
      expect(two).toContain(
        '<link rel="canonical" href="https://fixture.example/pages/blog/page/2/">',
      );
      expect(two).toContain('<p class="self">/pages/blog/page/2/</p>');
    });

    it('emits rel=prev/next only where a neighbouring page exists', async () => {
      await buildSite(paginatedFixture, out);

      const one = await readFile(join(out, 'pages/blog/index.html'), 'utf8');
      expect(one).not.toContain('rel="prev"');
      expect(one).toContain(
        '<link rel="next" href="https://fixture.example/pages/blog/page/2/">',
      );

      const two = await readFile(join(out, 'pages/blog/page/2/index.html'), 'utf8');
      expect(two).toContain(
        '<link rel="prev" href="https://fixture.example/pages/blog/">',
      );
      expect(two).toContain(
        '<link rel="next" href="https://fixture.example/pages/blog/page/3/">',
      );

      const three = await readFile(join(out, 'pages/blog/page/3/index.html'), 'utf8');
      expect(three).toContain(
        '<link rel="prev" href="https://fixture.example/pages/blog/page/2/">',
      );
      expect(three).not.toContain('rel="next"');
    });

    it('renders a pager through a `{% render %}` partial (isolated scope, SPEC §6)', async () => {
      await buildSite(paginatedFixture, out);
      const two = await readFile(join(out, 'pages/blog/page/2/index.html'), 'utf8');
      expect(two).toContain('<nav class="pagination">');
      expect(two).toContain('<a rel="prev" href="/pages/blog/">Previous</a>');
      expect(two).toContain('<a href="/pages/blog/">1</a>');
      expect(two).toContain('<span class="current">2</span>');
      expect(two).toContain('<a href="/pages/blog/page/3/">3</a>');
      expect(two).toContain('<a rel="next" href="/pages/blog/page/3/">Next</a>');
    });

    it('exposes Jekyll pagination names too, so an imported theme’s pager works', async () => {
      await buildSite(paginatedFixture, out);
      const one = await readFile(join(out, 'pages/blog/index.html'), 'utf8');
      // paginator.posts.size / total_pages / next_page_path
      expect(one).toContain('<p class="jekyll">2 3 /pages/blog/page/2/</p>');
    });

    it('lists every page in sitemap.xml', async () => {
      await buildSite(paginatedFixture, out);
      const sitemap = await readFile(join(out, 'sitemap.xml'), 'utf8');
      expect(sitemap).toContain('<loc>https://fixture.example/pages/blog/</loc>');
      expect(sitemap).toContain('<loc>https://fixture.example/pages/blog/page/2/</loc>');
      expect(sitemap).toContain('<loc>https://fixture.example/pages/blog/page/3/</loc>');
    });

    it('still renders one page — with no pager — for an empty collection', async () => {
      await buildSite(paginatedFixture, out);
      const empty = await readFile(join(out, 'pages/empty/index.html'), 'utf8');
      expect(empty).toContain('<h1>Notes</h1>');
      expect(empty).toContain('<p class="count">1/1 of 0</p>');
      expect(empty).not.toContain('<nav class="pagination">');
      expect(await exists(join(out, 'pages/empty/page/2/index.html'))).toBe(false);
    });

    it('leaves ordinary pages with no paginator, so listing markup is a no-op', async () => {
      await buildSite(paginatedFixture, out);
      const post = await readFile(join(out, 'posts/post-1/index.html'), 'utf8');
      expect(post).not.toContain('class="listing"');
      expect(post).not.toContain('class="pagination"');
    });

    it('the shipped default theme renders the listing + pager (site-template)', async () => {
      // Build the real site-template — the scaffold every new site starts from — with a
      // posts type and a paginated blog page added, so the theme's own pagination markup
      // (default.liquid's listing + templates/pagination.liquid) is covered, not just the
      // mechanism. Guards the theme against drift from the generator.
      const repo = join(out, 'repo');
      const site = join(out, 'site');
      await cp(siteTemplate, repo, { recursive: true });
      await writeFile(
        join(repo, 'config/schemas/posts.yml'),
        'kind: collection\nhasBody: true\nfields:\n  title:\n    type: text\n    required: true\n  description:\n    type: text\n  date:\n    type: date\n',
      );
      for (const n of [1, 2, 3]) {
        await mkdir(join(repo, `content/posts/post-${n}`), { recursive: true });
        await writeFile(
          join(repo, `content/posts/post-${n}/index.md`),
          `---\nid: POST-${n}\ntitle: Post ${n}\ndescription: About post ${n}.\ndate: 2026-0${n}-01\npublic: true\n---\n\nBody ${n}.\n`,
        );
      }
      await mkdir(join(repo, 'content/pages/blog'), { recursive: true });
      await writeFile(
        join(repo, 'content/pages/blog/index.md'),
        '---\nid: PAGE-BLOG\ntitle: Blog\npublic: true\npaginate:\n  collection: posts\n  size: 2\n---\n\nLatest writing.\n',
      );

      await buildSite(repo, site);

      const one = await readFile(join(site, 'pages/blog/index.html'), 'utf8');
      expect(one).toContain('<h1>Blog</h1>');
      expect(one).toContain('class="listing__link"');
      expect(one).toContain('>Post 3</a>');
      expect(one).toContain('<p class="listing__excerpt">About post 3.</p>');
      expect(one).toContain('<nav class="pagination" aria-label="Pagination">');
      expect(one).toContain('aria-current="page"');
      expect(one).toContain('Next →');

      const two = await readFile(join(site, 'pages/blog/page/2/index.html'), 'utf8');
      expect(two).toContain('>Post 1</a>');
      expect(two).toContain('← Previous');
      expect(two).toContain('<link rel="prev"');

      // An ordinary page in the same theme shows no listing at all.
      const about = await readFile(join(site, 'pages/about/index.html'), 'utf8');
      expect(about).not.toContain('class="listing"');
      expect(about).not.toContain('class="pagination"');
    });
  });
});
