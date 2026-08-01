import { describe, expect, it } from 'vitest';
import { splitExcerpt, renderExcerpt } from '../src/excerpt.js';
import { renderMarkdown } from '../src/markdown.js';

/**
 * Listing-page excerpts (SPEC §6). The behaviour that matters to an author: an explicit
 * `<!--more-->` wins; otherwise the first paragraph; and "Read more" appears only when
 * there is genuinely more to read.
 */
describe('splitExcerpt', () => {
  it('cuts at an explicit <!--more--> marker', () => {
    const body = [
      'Opening.',
      '',
      'Still opening.',
      '',
      '<!--more-->',
      '',
      '# Rest',
      '',
    ].join('\n');
    const { markdown, truncated } = splitExcerpt(body);
    expect(markdown.trim()).toBe('Opening.\n\nStill opening.');
    expect(truncated).toBe(true);
  });

  it('tolerates whitespace inside the marker', () => {
    const { markdown } = splitExcerpt('Opening.\n\n<!-- more -->\n\nRest.\n');
    expect(markdown.trim()).toBe('Opening.');
  });

  it('falls back to the first paragraph', () => {
    const body = ['First para.', '', 'Second para.', '', 'Third para.', ''].join('\n');
    const { markdown, truncated } = splitExcerpt(body);
    expect(markdown).toBe('First para.');
    expect(truncated).toBe(true);
  });

  it('keeps blocks that precede the first paragraph with it', () => {
    // A post opening with a floated figure: the image belongs with the sentence it
    // illustrates, so the excerpt must carry both rather than an orphaned picture.
    const body = [
      ':::figure{layout="wrap-right" size="md"}',
      '![A photo](photo.jpg)',
      ':::',
      '',
      'The opening sentence.',
      '',
      'A later paragraph.',
      '',
    ].join('\n');
    const { markdown, truncated } = splitExcerpt(body);
    expect(markdown).toContain(':::figure');
    expect(markdown).toContain('The opening sentence.');
    expect(markdown).not.toContain('A later paragraph.');
    expect(truncated).toBe(true);
  });

  it('reports a single-paragraph post as untruncated', () => {
    // The whole body IS the excerpt, so a theme must not offer a "Read more" that
    // leads to the same words the reader just read.
    const { markdown, truncated } = splitExcerpt('The entire post.\n');
    expect(markdown).toBe('The entire post.');
    expect(truncated).toBe(false);
  });

  it('treats a trailing marker with nothing after it as untruncated', () => {
    expect(splitExcerpt('All of it.\n\n<!--more-->\n').truncated).toBe(false);
  });

  it('returns a paragraph-less body whole', () => {
    const body = ['# Just a heading', '', '- and', '- a list', ''].join('\n');
    const { markdown, truncated } = splitExcerpt(body);
    expect(markdown).toBe(body);
    expect(truncated).toBe(false);
  });

  it('ignores a marker that is not at block level', () => {
    const { markdown } = splitExcerpt('A paragraph mentioning `<!--more-->` inline.\n');
    expect(markdown).toBe('A paragraph mentioning `<!--more-->` inline.');
  });
});

describe('renderExcerpt', () => {
  it('produces a prefix of what the full page renders', async () => {
    // The point of splitting the *source* rather than the HTML: the excerpt is what the
    // real page would have emitted for those blocks, not a second renderer's guess.
    const body = 'The **opening**.\n\n<!--more-->\n\nThe rest.\n';
    const { html } = await renderExcerpt(body);
    const full = await renderMarkdown(body);
    expect(full.startsWith(html.trim())).toBe(true);
  });

  it('rebases relative refs onto the given base', async () => {
    const { html } = await renderExcerpt('![Alt](photo.jpg)\n', {
      base: '/repo/posts/hello/',
    });
    expect(html).toContain('src="/repo/posts/hello/photo.jpg"');
  });

  it('applies the base path to a root-relative link', async () => {
    const { html } = await renderExcerpt('See [the portfolio](/portfolio).\n', {
      base: '/repo/posts/hello/',
      basePath: '/repo',
    });
    expect(html).toContain('href="/repo/portfolio"');
  });

  it('drops the marker from the output', async () => {
    const { html } = await renderExcerpt('Opening.\n\n<!--more-->\n\nRest.\n');
    expect(html).not.toContain('more');
    expect(html).not.toContain('Rest.');
  });
});
