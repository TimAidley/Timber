import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderPage } from '@timber/generator';
import { assembleContent, loadSchemas, pageSeo, siteContext } from '@timber/content';
import { buildSite, BuildError } from '../src/build.node.js';
import { buildSnapshotFromDir } from '../src/snapshot.node.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteFixture = join(here, 'fixtures', 'site');
const invalidFixture = join(here, 'fixtures', 'site-invalid');

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

  it('omits drafts from the build', async () => {
    await buildSite(siteFixture, out);
    expect(await exists(join(out, 'pages/secret/index.html'))).toBe(false);
  });

  it('falls back to templates/default.liquid when no <type>.liquid exists', async () => {
    await buildSite(siteFixture, out);
    const note = await readFile(join(out, 'notes/note1/index.html'), 'utf8');
    expect(note).toContain('class="default"');
    expect(note).toContain('<h1>A Note</h1>');
  });

  it('copies site-wide and colocated assets', async () => {
    await buildSite(siteFixture, out);
    expect(await exists(join(out, 'assets/site.css'))).toBe(true);
    // colocated bundle asset ships next to its page
    const src = await readFile(join(siteFixture, 'content/events/fete/images/pixel.webp'));
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
    expect(hello).toContain('<link rel="canonical" href="https://fixture.example/pages/hello/">');
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
    const hello = model.objects.find((o) => o.path === 'content/pages/hello/index.md')!;
    const seo = pageSeo(hello, schemas.get('pages')!, site);

    const markdown = await readFile(join(siteFixture, 'content/pages/hello/index.md'), 'utf8');
    const template = await readFile(join(siteFixture, 'templates/pages.liquid'), 'utf8');
    const preview = await renderPage({ markdown, template, site, seo });

    expect(built).toBe(preview);
  });
});
