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

  it('still neutralises other stray directives to text', async () => {
    const html = await renderMarkdown('Ship it :tada: and fix TODO:later please.\n');
    expect(html).toContain(':tada:');
    expect(html).toContain('TODO:later');
    expect(html).not.toContain('wordmark');
  });
});
