import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderPage } from '../src/index.js';

/** A minimal whole-page template — the wordmark styling is injected per page, not per body. */
const PAGE = '<html><head><title>t</title></head><body>{{ content }}</body></html>';

/**
 * The `:timber-logo` brand-wordmark shortcode (SPEC §7 → Brand wordmark) renders the
 * exact editor-header wordmark into body content — nested spans (`.wordmark` /
 * `.wordmark__tim`) styled by the self-contained `<style>` the generator injects. It rides
 * the same `remark-directive` seam as `:::figure`; every OTHER directive still neutralises
 * to plain text, so this must not regress that.
 */
describe('timber-logo wordmark shortcode', () => {
  it('renders the wordmark markup inline in prose', async () => {
    const html = await renderMarkdown('Built with :timber-logo today.\n');
    expect(html).toContain(
      '<span class="wordmark"><span class="wordmark__tim">Tim</span>ber</span>',
    );
    // Inline: stays inside the surrounding paragraph, no block wrapper of its own.
    expect(html).toContain('Built with <span class="wordmark">');
  });

  it('keeps the wordmark classes through sanitisation', async () => {
    const html = await renderMarkdown(':timber-logo\n');
    expect(html).toContain('class="wordmark"');
    expect(html).toContain('class="wordmark__tim"');
  });

  it('injects self-contained styling (rules + embedded font) so it needs no theme setup', async () => {
    const html = await renderPage({
      markdown: 'Built with :timber-logo.\n',
      template: PAGE,
    });
    // A single <style> carrying the @font-face + .wordmark rules...
    expect(html).toContain('<style>');
    expect(html).toContain('@font-face');
    expect(html).toContain('.wordmark{');
    expect(html).toContain('.wordmark__tim{');
    // ...with the Fraunces logo face embedded (base64 data URI), not a theme font path.
    expect(html).toContain('data:font/woff2;base64,');
  });

  it('puts the styling in the head, so it applies to the whole page', async () => {
    const html = await renderPage({ markdown: ':timber-logo\n', template: PAGE });
    expect(html.indexOf('@font-face')).toBeLessThan(html.indexOf('</head>'));
  });

  it('carries its own brand ink rather than inheriting the surrounding text colour', async () => {
    // A logo has to read the same everywhere. Following `--fg`/`currentColor` meant that in
    // muted text (a footer) the full-ink "Tim" faded and the two-tone contrast collapsed.
    const html = await renderPage({ markdown: ':timber-logo\n', template: PAGE });
    expect(html).toContain('#1b2230'); // ink, matching the editor chrome's --text
    expect(html).toContain('#5b6472'); // muted, matching --text-muted
    expect(html).not.toContain('currentColor');
    expect(html).not.toContain('var(--fg');
    expect(html).not.toContain('var(--muted');
  });

  it('inverts on a dark page via the declared colour scheme, not the visitor OS setting', async () => {
    // `prefers-color-scheme` would flip the logo to near-white on a light-only site whenever
    // the visitor's OS is dark — invisible. `light-dark()` follows the page's own scheme.
    const html = await renderPage({ markdown: ':timber-logo\n', template: PAGE });
    expect(html).toContain('light-dark(#1b2230,#e7eaf0)');
    expect(html).toContain('light-dark(#5b6472,#9aa4b4)');
    expect(html).not.toContain('prefers-color-scheme');
  });

  it('lets a theme recolour it for a section that bucks the page scheme', async () => {
    const html = await renderPage({ markdown: ':timber-logo\n', template: PAGE });
    expect(html).toContain('var(--wordmark-ink,');
    expect(html).toContain('var(--wordmark-muted,');
  });

  it('injects the style only once even with multiple logos, and not at all without one', async () => {
    const two = await renderPage({
      markdown: 'Made by :timber-logo and :timber-logo.\n',
      template: PAGE,
    });
    expect(two.match(/@font-face/g)?.length).toBe(1);
    const none = await renderPage({
      markdown: 'Just ordinary prose here.\n',
      template: PAGE,
    });
    expect(none).not.toContain('wordmark');
    expect(none).not.toContain('data:font/woff2');
  });

  it('falls back to prepending when the template renders a bare fragment (no head)', async () => {
    const html = await renderPage({
      markdown: ':timber-logo\n',
      template: '<div>{{ content }}</div>',
    });
    expect(html).toContain('data:font/woff2;base64,');
    expect(html.indexOf('@font-face')).toBeLessThan(html.indexOf('<div>'));
  });

  it('leaves the rendered body fragment itself unstyled — the page owns the style', async () => {
    const body = await renderMarkdown('Built with :timber-logo.\n');
    expect(body).toContain('class="wordmark"');
    expect(body).not.toContain('@font-face');
  });

  it('still neutralises other stray directives to text', async () => {
    const html = await renderMarkdown('Ship it :tada: and fix TODO:later please.\n');
    expect(html).toContain(':tada:');
    expect(html).toContain('TODO:later');
    expect(html).not.toContain('wordmark');
  });
});
