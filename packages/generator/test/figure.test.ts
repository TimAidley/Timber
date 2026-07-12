import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/index.js';

/**
 * The `:::figure` image directive (SPEC §7) renders to semantic `<figure>` markup with
 * generator-computed layout classes, a lazy-loaded `<img>`, and an optional
 * `<figcaption>`. Layout/size decisions live in classes (the theme owns the pixels);
 * captions keep their Markdown formatting. Stray non-figure directives must survive as
 * plain text so hand-edited colon prose renders as written.
 */
describe('figure directive rendering', () => {
  it('renders a full-width figure with a formatted caption', async () => {
    const html = await renderMarkdown(
      [
        ':::figure',
        '![A tree at dawn](tree.webp)',
        '',
        'Planted at _dawn_ — see the [gallery](/gallery).',
        ':::',
        '',
      ].join('\n'),
    );
    expect(html).toContain('<figure class="fig fig--full-width fig--md">');
    expect(html).toContain('<img src="tree.webp" alt="A tree at dawn" loading="lazy" decoding="async">');
    expect(html).toContain('<figcaption>');
    expect(html).toContain('<em>dawn</em>');
    expect(html).toContain('<a href="/gallery">gallery</a>');
    expect(html).toContain('</figure>');
  });

  it('applies layout and size classes from directive attributes', async () => {
    const html = await renderMarkdown(
      ':::figure{layout="wrap-right" size="lg"}\n![Boat](boat.webp)\n:::\n',
    );
    expect(html).toContain('<figure class="fig fig--wrap-right fig--lg">');
    // No caption paragraph → no figcaption.
    expect(html).not.toContain('<figcaption>');
  });

  it('falls back to defaults for unknown layout/size values', async () => {
    const html = await renderMarkdown(
      ':::figure{layout="diagonal" size="huge"}\n![X](x.webp)\n:::\n',
    );
    expect(html).toContain('<figure class="fig fig--full-width fig--md">');
  });

  it('renders a bare Markdown image without a figure wrapper', async () => {
    const html = await renderMarkdown('![Plain](p.webp)\n');
    expect(html).toContain('<img src="p.webp" alt="Plain">');
    expect(html).not.toContain('<figure');
  });

  it('neutralizes stray non-figure directives to text', async () => {
    const html = await renderMarkdown('Ship it :tada: and fix TODO:later please.\n');
    expect(html).toContain(':tada:');
    expect(html).toContain('TODO:later');
    expect(html).not.toContain('<figure');
  });
});
