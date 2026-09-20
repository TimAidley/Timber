import { describe, expect, it } from 'vitest';
import { embedHtml } from '../src/embedMarkup.js';
import { renderPage } from '../src/index.js';

const GAME = 'https://tim.aidley.com/redbaron/';
const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** A minimal whole-page template — the styling and script are injected per page. */
const PAGE = '<html><head><title>t</title></head><body>{{ content }}</body></html>';

async function page(
  template: string,
  markdown = '---\ntitle: t\n---\n\nBody.\n',
): Promise<string> {
  return renderPage({ markdown, template });
}

describe('embedHtml — the facade', () => {
  it('wraps the poster in a link to the embedded URL, with a play control over it', () => {
    const html = embedHtml({ url: GAME, poster: 'game.webp', label: 'Red Baron' });
    expect(html).toContain(
      '<a class="embed__launch" href="https://tim.aidley.com/redbaron/"',
    );
    expect(html).toContain('<img class="embed__poster" src="game.webp"');
    expect(html).toContain('class="embed__play"');
  });

  it('names the control for a screen reader and leaves the poster decorative', () => {
    // A described image inside a described link is announced twice.
    const html = embedHtml({ url: GAME, poster: 'game.webp', label: 'Red Baron' });
    expect(html).toContain('aria-label="Play Red Baron"');
    expect(html).toContain('alt=""');
  });

  it('defaults to click-to-load and carries the resolved src for the script', () => {
    const html = embedHtml({ url: GAME, poster: 'game.webp' });
    expect(html).toContain('class="embed embed--inline"');
    expect(html).toContain('data-embed-src="https://tim.aidley.com/redbaron/"');
  });

  it('emits a plain link with no script hooks in newtab mode', () => {
    const html = embedHtml({ url: GAME, poster: 'game.webp', mode: 'newtab' });
    expect(html).toContain('class="embed embed--newtab"');
    expect(html).not.toContain('data-embed-src');
    // Still the same anchor: the two modes differ only in what happens on click.
    expect(html).toContain('href="https://tim.aidley.com/redbaron/" target="_blank"');
  });

  it('resolves a provider link to its player and borrows the provider poster', () => {
    const html = embedHtml({ url: VIDEO, label: 'Never Gonna Give You Up' });
    expect(html).toContain(
      'data-embed-src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
    expect(html).toContain('src="https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"');
    // The click that swapped the frame in was the play gesture.
    expect(html).toContain('autoplay=1');
  });

  it('never adds query parameters to a direct embed', () => {
    expect(embedHtml({ url: GAME })).not.toContain('autoplay');
  });

  it('prefers an explicit poster over the provider’s', () => {
    const html = embedHtml({ url: VIDEO, poster: 'my-own.webp' });
    expect(html).toContain('src="my-own.webp"');
    expect(html).not.toContain('img.youtube.com');
  });

  it('emits the control without a poster, rather than an empty box', () => {
    const html = embedHtml({ url: GAME, label: 'Red Baron' });
    expect(html).not.toContain('embed__poster');
    expect(html).toContain('class="embed__play"');
    expect(html).toContain('aria-label="Play Red Baron"');
  });

  it('emits nothing for a URL that cannot be embedded', () => {
    // The validator has already reported it against the field; a page that renders it
    // is an unpublishable draft, not a page quietly missing markup.
    expect(embedHtml({ url: 'http://example.com/game/' })).toBe('');
    expect(embedHtml({ url: 'javascript:alert(1)' })).toBe('');
    expect(embedHtml({ url: 'not a url' })).toBe('');
  });
});

describe('embedHtml — untrusted values', () => {
  it('escapes a label into the attribute it lands in', () => {
    const html = embedHtml({ url: GAME, label: '"><script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#34;&gt;&lt;script&gt;');
  });

  it('escapes a poster path so it cannot close the attribute and open an element', () => {
    const html = embedHtml({ url: GAME, poster: '"><img onerror=alert(1) x="' });
    // Exactly one `<img` — ours. The payload stays inside the src attribute as text,
    // which is why asserting on the substring alone would miss the point.
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).toContain('src="&#34;&gt;&lt;img onerror=alert(1) x=&#34;"');
  });

  it('takes a well-formed aspect ratio', () => {
    expect(embedHtml({ url: GAME, ratio: '4 / 3' })).toContain(
      'style="--embed-ratio:4 / 3"',
    );
    expect(embedHtml({ url: GAME, ratio: '1.5' })).toContain('style="--embed-ratio:1.5"');
  });

  it('takes a max width as a CSS length', () => {
    expect(embedHtml({ url: GAME, width: '640px' })).toContain(
      'style="--embed-ratio:16 / 9;--embed-width:640px"',
    );
  });

  it('refuses a width that is not a plain length', () => {
    const html = embedHtml({ url: GAME, width: 'calc(100% - 2rem)' });
    expect(html).toContain('style="--embed-ratio:16 / 9"');
    expect(html).not.toContain('calc');
  });

  it('falls back to the default rather than letting a ratio add declarations of its own', () => {
    // Escaping alone would keep this inside the attribute but still add a rule.
    const html = embedHtml({ url: GAME, ratio: '1;background:url(http://evil/)' });
    expect(html).toContain('style="--embed-ratio:16 / 9"');
    expect(html).not.toContain('evil');
  });
});

describe('the {% embed %} tag', () => {
  it('builds the facade from named arguments', async () => {
    const html = await page(
      `<html><head></head><body>{% embed url: page.game, poster: page.thumb, label: page.title %}</body></html>`,
      '---\ntitle: Red Baron\ngame: https://tim.aidley.com/redbaron/\nthumb: game.webp\n---\n',
    );
    expect(html).toContain('class="embed embed--inline"');
    expect(html).toContain('aria-label="Play Red Baron"');
    expect(html).toContain('src="game.webp"');
  });

  it('renders nothing when the page has no embed, so a theme can call it unconditionally', async () => {
    const html = await page(
      `<html><head></head><body><main>{% embed url: page.game %}</main></body></html>`,
    );
    expect(html).toContain('<main></main>');
    expect(html).not.toContain('<style>');
  });

  it('passes the mode through', async () => {
    const html = await page(
      `<html><head></head><body>{% embed url: page.game, mode: 'newtab' %}</body></html>`,
      '---\ntitle: t\ngame: https://tim.aidley.com/redbaron/\n---\n',
    );
    expect(html).toContain('embed--newtab');
  });
});

describe('injected styling and script', () => {
  const withEmbed = (mode: string) =>
    page(
      `<html><head><title>t</title></head><body>{% embed url: page.game, mode: '${mode}' %}</body></html>`,
      '---\ntitle: t\ngame: https://tim.aidley.com/redbaron/\n---\n',
    );

  it('gives an embed working styling and a working play button with no theme setup', async () => {
    const html = await withEmbed('inline');
    expect(html).toContain('<style>@layer timber.embed{');
    expect(html).toContain('<script>');
    expect(html).toContain('data-embed-src');
  });

  it('puts the baseline in a cascade layer so an ordinary theme rule overrides it', async () => {
    const html = await withEmbed('inline');
    expect(html).toMatch(/<style>@layer timber\.embed\{.*\.embed__play/s);
  });

  it('injects the style into the head and the script at the end of the body', async () => {
    const html = await withEmbed('inline');
    expect(html.indexOf('<style>')).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</body>'));
    expect(html.indexOf('<script>')).toBeGreaterThan(html.indexOf('<body>'));
  });

  it('skips the script for a newtab embed, which needs none', async () => {
    const html = await withEmbed('newtab');
    expect(html).toContain('@layer timber.embed');
    expect(html).not.toContain('<script>');
  });

  it('injects once, however many embeds a page carries', async () => {
    const html = await page(
      `<html><head></head><body>{% embed url: page.game %}{% embed url: page.game %}</body></html>`,
      '---\ntitle: t\ngame: https://tim.aidley.com/redbaron/\n---\n',
    );
    expect(html.match(/@layer timber\.embed/g)).toHaveLength(1);
    expect(html.match(/<script>/g)).toHaveLength(1);
  });

  it('leaves a page with no embed completely untouched', async () => {
    const html = await page(PAGE);
    expect(html).not.toContain('<style>');
    expect(html).not.toContain('<script>');
  });

  it('still applies to a bare fragment with no head or body', async () => {
    const html = await page(
      `{% embed url: page.game %}`,
      '---\ntitle: t\ngame: ' + GAME + '\n---\n',
    );
    expect(html).toContain('@layer timber.embed');
    expect(html).toContain('<script>');
  });
});

describe('embedHtml — the loaded iframe can differ from the poster', () => {
  it('carries a frame ratio for the script to apply on activation', () => {
    const html = embedHtml({ url: GAME, ratio: '16 / 9', frameRatio: '4 / 3' });
    expect(html).toContain('style="--embed-ratio:16 / 9"');
    expect(html).toContain('data-embed-frame-ratio="4 / 3"');
  });

  it('carries a frame width too', () => {
    const html = embedHtml({ url: GAME, width: '100%', frameWidth: '640px' });
    expect(html).toContain('data-embed-frame-width="640px"');
  });

  it('carries nothing when the frame matches the poster, the common case', () => {
    const html = embedHtml({
      url: GAME,
      ratio: '4 / 3',
      frameRatio: '4 / 3',
      width: '640px',
    });
    expect(html).not.toContain('data-embed-frame-ratio');
    expect(html).not.toContain('data-embed-frame-width');
  });

  it('carries nothing in newtab mode, where nothing is ever swapped in', () => {
    const html = embedHtml({ url: GAME, mode: 'newtab', frameRatio: '4 / 3' });
    expect(html).not.toContain('data-embed-frame');
  });

  it('ignores a frame value of the wrong shape', () => {
    const html = embedHtml({ url: GAME, frameRatio: '4;color:red', frameWidth: 'wide' });
    expect(html).not.toContain('data-embed-frame');
  });
});
