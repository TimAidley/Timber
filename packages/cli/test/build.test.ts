import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderPage } from '@timber/generator';
import { buildSite, BuildError } from '../src/build.node.js';

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

    expect(result.pages).toBe(3); // hello, fete, note1
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

  it('build output equals renderPage output for the same object (preview ≡ build)', async () => {
    await buildSite(siteFixture, out);
    const built = await readFile(join(out, 'pages/hello/index.html'), 'utf8');

    // The "browser preview" path: same renderPage, same inputs.
    const markdown = await readFile(join(siteFixture, 'content/pages/hello/index.md'), 'utf8');
    const template = await readFile(join(siteFixture, 'templates/pages.liquid'), 'utf8');
    const preview = await renderPage({ markdown, template, site: {} });

    expect(built).toBe(preview);
  });
});
