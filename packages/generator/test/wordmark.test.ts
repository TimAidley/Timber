import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/index.js';

/**
 * The `:timber-logo` brand-wordmark shortcode (SPEC §7 → Brand wordmark) renders the
 * exact editor-header wordmark into body content — nested spans (`.wordmark` /
 * `.wordmark__tim`) that the theme styles with the vendored Fraunces face. It rides the
 * same `remark-directive` seam as `:::figure`; every OTHER directive still neutralises
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
    const html = await renderMarkdown('Built with :timber-logo.\n');
    // A single <style> carrying the @font-face + .wordmark rules...
    expect(html).toContain('<style>');
    expect(html).toContain('@font-face');
    expect(html).toContain(".wordmark{");
    expect(html).toContain(".wordmark__tim{");
    // ...with the Fraunces logo face embedded (base64 data URI), not a theme font path.
    expect(html).toContain('data:font/woff2;base64,');
  });

  it('injects the style only once even with multiple logos, and not at all without one', async () => {
    const two = await renderMarkdown('Made by :timber-logo and :timber-logo.\n');
    expect(two.match(/<style>/g)?.length).toBe(1);
    const none = await renderMarkdown('Just ordinary prose here.\n');
    expect(none).not.toContain('wordmark');
    expect(none).not.toContain('data:font/woff2');
  });

  it('still neutralises other stray directives to text', async () => {
    const html = await renderMarkdown('Ship it :tada: and fix TODO:later please.\n');
    expect(html).toContain(':tada:');
    expect(html).toContain('TODO:later');
    expect(html).not.toContain('wordmark');
  });
});
