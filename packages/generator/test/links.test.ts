import { describe, expect, it } from 'vitest';
import { rebaseHtml } from '../src/links.js';
import { renderPage } from '../src/render.js';

/**
 * Body-link rewriting. A Markdown body has no `relative_url` filter to reach for, so the
 * two things templates do explicitly have to happen to the rendered HTML instead:
 * root-relative references get the site's base path, and relative ones are resolved
 * against the page they were written on (needed only when the markup is lifted elsewhere).
 */
describe('rebaseHtml', () => {
  const base = '/repo/posts/hello/';
  const basePath = '/repo';

  it('prefixes the base path onto a root-relative reference', () => {
    expect(rebaseHtml('<a href="/portfolio"></a>', { basePath })).toBe(
      '<a href="/repo/portfolio"></a>',
    );
  });

  it('leaves root-relative references alone on a root site', () => {
    // `basePath` is '' for a custom domain or user-Pages site: already correct as written.
    const html = '<a href="/portfolio"></a>';
    expect(rebaseHtml(html, { basePath: '' })).toBe(html);
  });

  it('resolves a colocated asset against the object URL', () => {
    expect(rebaseHtml('<img src="photo.jpg">', { base })).toBe(
      '<img src="/repo/posts/hello/photo.jpg">',
    );
  });

  it('resolves ./ and ../ segments', () => {
    expect(rebaseHtml('<img src="./a/../b.png">', { base })).toBe(
      '<img src="/repo/posts/hello/b.png">',
    );
  });

  it('does both at once', () => {
    expect(
      rebaseHtml('<img src="photo.jpg"><a href="/about"></a>', { base, basePath }),
    ).toBe('<img src="/repo/posts/hello/photo.jpg"><a href="/repo/about"></a>');
  });

  it('leaves relative references alone when no base is given', () => {
    // Rendering a body *into* its own page: `photo.jpg` already resolves there, and
    // rewriting it would churn output bytes for nothing.
    const html = '<img src="photo.jpg">';
    expect(rebaseHtml(html, { basePath })).toBe(html);
  });

  it('never touches external, protocol-relative or fragment references', () => {
    const html =
      '<a href="https://x.test/y"></a><a href="mailto:a@b.test"></a>' +
      '<img src="//cdn.test/z.png"><a href="#section"></a>';
    expect(rebaseHtml(html, { base, basePath })).toBe(html);
  });

  it('preserves query and hash on a rebased reference', () => {
    expect(rebaseHtml('<a href="doc.pdf?v=2#page3"></a>', { base })).toBe(
      '<a href="/repo/posts/hello/doc.pdf?v=2#page3"></a>',
    );
  });

  it('is a no-op with neither option', () => {
    const html = '<img src="photo.jpg"><a href="/about"></a>';
    expect(rebaseHtml(html, {})).toBe(html);
  });
});

describe('renderPage body links', () => {
  it('applies the site base path to a root-relative body link', async () => {
    const html = await renderPage({
      markdown: '---\ntitle: T\n---\n\nSee [the portfolio](/portfolio).\n',
      template: '{{ content }}',
      site: { basePath: '/repo' },
    });
    expect(html).toContain('href="/repo/portfolio"');
  });

  it('leaves a body link untouched on a root site', async () => {
    const html = await renderPage({
      markdown: '---\ntitle: T\n---\n\nSee [the portfolio](/portfolio).\n',
      template: '{{ content }}',
      site: { basePath: '' },
    });
    expect(html).toContain('href="/portfolio"');
  });

  it('leaves a colocated image relative on the page that owns it', async () => {
    const html = await renderPage({
      markdown: '---\ntitle: T\n---\n\n![Alt](photo.jpg)\n',
      template: '{{ content }}',
      site: { basePath: '/repo' },
    });
    expect(html).toContain('src="photo.jpg"');
  });
});
