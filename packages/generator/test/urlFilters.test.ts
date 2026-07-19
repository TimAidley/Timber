import { describe, it, expect } from 'vitest';
import { renderPage } from '../src/render.js';

/**
 * Tier-1 native changes: the `relative_url` / `absolute_url` filters and the computed
 * `page.url` / `page.collection` context. These make Timber's own link idiom cleaner and
 * are the highest-frequency things a ported theme reads — so they're covered natively here,
 * independent of any compatibility layer.
 */
describe('native url filters', () => {
  const site = { basePath: '/mysite', baseUrl: 'https://example.github.io/mysite' };

  it('relative_url prefixes site.basePath and ensures a leading slash', async () => {
    const out = await renderPage({
      markdown: '',
      template: "{{ '/assets/x.css' | relative_url }}|{{ 'feed.xml' | relative_url }}",
      site,
    });
    expect(out).toBe('/mysite/assets/x.css|/mysite/feed.xml');
  });

  it('absolute_url prefixes site.baseUrl', async () => {
    const out = await renderPage({
      markdown: '',
      template: "{{ '/about/' | absolute_url }}",
      site,
    });
    expect(out).toBe('https://example.github.io/mysite/about/');
  });

  it('leaves already-absolute URLs untouched', async () => {
    const out = await renderPage({
      markdown: '',
      template: "{{ 'https://cdn.example/x.js' | relative_url }}",
      site,
    });
    expect(out).toBe('https://cdn.example/x.js');
  });

  it('degrades to a plain leading slash when no base path is set', async () => {
    const out = await renderPage({
      markdown: '',
      template: "{{ '/a/' | relative_url }}",
      site: {},
    });
    expect(out).toBe('/a/');
  });
});

describe('computed page context', () => {
  it('injects page.url and page.collection, winning over front matter', async () => {
    const out = await renderPage({
      markdown: '---\nurl: /wrong/\ntitle: T\n---\nbody',
      template: '{{ page.url }}|{{ page.collection }}|{{ page.title }}',
      url: '/posts/hi/',
      collection: 'posts',
    });
    expect(out).toBe('/posts/hi/|posts|T');
  });

  it('exposes page.content as the rendered body (raw), like a Jekyll layout', async () => {
    const out = await renderPage({
      markdown: '---\n---\n**bold**',
      template: '{{ page.content }}',
    });
    expect(out).toContain('<strong>bold</strong>');
  });

  it('omits page.url when the caller supplies none', async () => {
    const out = await renderPage({ markdown: '', template: '[{{ page.url }}]' });
    expect(out).toBe('[]');
  });
});
