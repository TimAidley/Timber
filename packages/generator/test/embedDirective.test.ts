import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderPage } from '../src/index.js';
import { embedHtml } from '../src/embedMarkup.js';

const GAME = 'https://tim.aidley.com/redbaron/';
const DIRECTIVE = `::embed{url="${GAME}" poster="game.webp" label="Red Baron"}`;

describe('the ::embed body directive', () => {
  it('renders the facade from a body block', async () => {
    const html = await renderMarkdown(`${DIRECTIVE}\n`);
    expect(html).toContain('class="embed embed--inline"');
    expect(html).toContain(`data-embed-src="${GAME}"`);
    expect(html).toContain('class="embed__launch"');
    expect(html).toContain('src="game.webp"');
    expect(html).toContain('aria-label="Play Red Baron"');
  });

  it('emits the same component as the tag, so one script and one stylesheet serve both', async () => {
    const fromBody = await renderMarkdown(`${DIRECTIVE}\n`);
    const fromTag = embedHtml({ url: GAME, poster: 'game.webp', label: 'Red Baron' });
    // Same tree, serialised by two different writers: hast closes void elements the
    // HTML way (`<img …>`), the tag's own serialiser closes them XML-style.
    const normalise = (html: string) =>
      html
        .replace(/ \/>/g, '>')
        .replace(/<\/path>/g, '')
        .replace(/\s+$/, '');
    expect(normalise(fromBody)).toBe(normalise(fromTag));
  });

  it('takes the container form too', async () => {
    const html = await renderMarkdown(`:::embed{url="${GAME}"}\n:::\n`);
    expect(html).toContain('class="embed embed--inline"');
  });

  it('takes mode, ratio and label', async () => {
    const html = await renderMarkdown(
      `::embed{url="${GAME}" mode="newtab" ratio="4 / 3" label="Red Baron"}\n`,
    );
    expect(html).toContain('class="embed embed--newtab"');
    expect(html).toContain('style="--embed-ratio:4 / 3"');
    expect(html).not.toContain('data-embed-src');
  });

  it('takes the sizing attributes, and keeps them through sanitisation', async () => {
    const html = await renderMarkdown(
      `::embed{url="${GAME}" ratio="16 / 9" width="640px" frameRatio="4 / 3" frameWidth="100%"}\n`,
    );
    expect(html).toContain('style="--embed-ratio:16 / 9;--embed-width:640px"');
    expect(html).toContain('data-embed-frame-ratio="4 / 3"');
    expect(html).toContain('data-embed-frame-width="100%"');
  });

  it('keeps every part of the facade through sanitisation', async () => {
    const html = await renderMarkdown(`${DIRECTIVE}\n`);
    for (const fragment of [
      'class="embed embed--inline"',
      'style="--embed-ratio:16 / 9"',
      'class="embed__launch"',
      'class="embed__poster"',
      'class="embed__play"',
      'class="embed__play-icon"',
      'viewBox="0 0 384 512"',
      '<path d="M73 39',
    ]) {
      expect(html).toContain(fragment);
    }
  });

  it('carries its styling and script like any other embed', async () => {
    const html = await renderPage({
      markdown: `---\ntitle: t\n---\n\n${DIRECTIVE}\n`,
      template: '<html><head></head><body>{{ content }}</body></html>',
    });
    expect(html).toContain('@layer timber.embed');
    expect(html).toContain('<script>');
  });
});

describe('an ::embed the generator cannot resolve', () => {
  it.each([
    ['no url', '::embed{poster="game.webp"}'],
    ['an http url', '::embed{url="http://tim.aidley.com/redbaron/"}'],
    ['a javascript url', '::embed{url="javascript:alert(1)"}'],
  ])(
    'shows %s as the source it was typed as, like any other stray directive',
    async (_n, src) => {
      const html = await renderMarkdown(`${src}\n`);
      expect(html).not.toContain('class="embed');
      expect(html).toContain('::embed{');
      // Neutralised to text, not passed through as markup.
      expect(html).not.toContain('<script');
    },
  );

  it('adds no styling or script to a page whose only embed failed', async () => {
    const html = await renderPage({
      markdown: '---\ntitle: t\n---\n\n::embed{url="http://insecure.example/"}\n',
      template: '<html><head></head><body>{{ content }}</body></html>',
    });
    expect(html).not.toContain('@layer timber.embed');
  });
});

describe('other directives are unaffected', () => {
  it('still renders a figure', async () => {
    const html = await renderMarkdown(
      ':::figure{layout="center"}\n\n![A plane](p.webp)\n\n:::\n',
    );
    expect(html).toContain('<figure class="fig fig--center fig--md">');
  });

  it('still neutralises a stray directive', async () => {
    const html = await renderMarkdown('::embedded{not="a directive"}\n');
    expect(html).toContain('<p>::embedded{not="a directive"}</p>');
  });

  it('leaves a directive inside a code fence alone', async () => {
    const html = await renderMarkdown('```\n::embed{url="https://example.com/"}\n```\n');
    expect(html).toContain('<code');
    expect(html).not.toContain('class="embed ');
  });
});
