import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderPage, parseFrontMatter } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

const markdown = readFileSync(join(fixtures, 'sample', 'index.md'), 'utf8');
const template = readFileSync(join(fixtures, 'page.liquid'), 'utf8');

// This suite runs under BOTH vitest projects (node + jsdom, see
// vitest.workspace.ts). The snapshot file is shared, so if the generator produced
// different bytes in the two environments, the second project to run would fail
// the snapshot comparison. That — plus the generator building with no @types/node
// (so any Node-only global is a compile error) — is the Phase 1 "preview ≡ build"
// proof.
describe('generator fidelity', () => {
  it('renders a page to byte-stable HTML (golden snapshot)', async () => {
    const html = await renderPage({ markdown, template, site: { name: 'Village News' } });
    await expect(html).toMatchFileSnapshot(join(fixtures, 'expected.html'));
  });

  it('runs the full SPEC §6 pipeline (gfm + highlight + liquid)', async () => {
    const html = await renderPage({ markdown, template, site: { name: 'Village News' } });

    // Liquid populated front-matter fields
    expect(html).toContain('<title>Summer Fête 2026 · Village News</title>');
    expect(html).toContain('data-id="01J8Z3K9Q7"');
    expect(html).toContain('content="community, outdoors"');

    // remark-gfm: table, strikethrough
    expect(html).toContain('<table>');
    expect(html).toContain('<del>No</del>');

    // rehype-highlight: code block got tokenised
    expect(html).toContain('class="hljs');

    // Body HTML emitted raw (not escaped) by Liquid
    expect(html).toContain('<h1>Summer Fête</h1>');
    expect(html).not.toContain('&lt;h1&gt;');
  });

  it('drops the front matter from the rendered body', async () => {
    const html = await renderPage({ markdown, template });
    expect(html).not.toContain('id: 01J8Z3K9Q7');
    expect(html).not.toContain('<hr>'); // front matter must not render as a rule
  });
});

describe('parseFrontMatter', () => {
  it('splits YAML data from the Markdown body', () => {
    const { data, body } = parseFrontMatter(markdown);
    expect(data.title).toBe('Summer Fête 2026');
    expect(data.public).toBe(true);
    expect(data.tags).toEqual(['community', 'outdoors']);
    expect(body.startsWith('# Summer Fête')).toBe(true);
  });

  it('tolerates a document with no front matter', () => {
    const { data, body } = parseFrontMatter('# Just a body\n\nNo front matter here.');
    expect(data).toEqual({});
    expect(body).toBe('# Just a body\n\nNo front matter here.');
  });
});
