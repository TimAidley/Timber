import { describe, it, expect } from 'vitest';
import { renderPage } from '../src/index.js';

/**
 * The Eleventy data cascade (SPEC §2 → Tier A). Eleventy exposes a page's front matter and
 * the `_data/*` globals as bare top-level variables (`{{ title }}`, `{{ metadata.x }}`),
 * not under `page.*` the way Jekyll/native Timber themes read them. `flattenData` + `globals`
 * expose that flat scope for an imported Eleventy theme — additive, opt-in, and never able to
 * shadow the reserved context names.
 */
describe('renderPage data cascade (Eleventy)', () => {
  const markdown = '---\ntitle: Hello World\n---\nBody **here**.';

  it('does NOT expose front matter at the top level by default (native/Jekyll)', async () => {
    const html = await renderPage({
      markdown,
      template: '<h1>{{ title }}</h1><h2>{{ page.title }}</h2>',
    });
    // Bare {{ title }} is empty; only page.title resolves — byte-identical to before.
    expect(html).toBe('<h1></h1><h2>Hello World</h2>');
  });

  it('exposes front matter at the top level under flattenData', async () => {
    const html = await renderPage({
      markdown,
      template: '<h1>{{ title }}</h1>',
      flattenData: true,
    });
    expect(html).toBe('<h1>Hello World</h1>');
  });

  it('exposes theme globals at the top level (keyed by data-file name)', async () => {
    const html = await renderPage({
      markdown,
      template: '<p>{{ metadata.author }}</p>',
      globals: { metadata: { author: 'Ada' } },
    });
    expect(html).toBe('<p>Ada</p>');
  });

  it('front matter wins over globals; reserved names win over both', async () => {
    // A front-matter `desc` beats a global `desc`; a front-matter `site`/`content` can never
    // clobber the real reserved `site`/`content`.
    const html = await renderPage({
      markdown: '---\ndesc: from-front-matter\nsite: HIJACK\n---\nreal body',
      template: '<a>{{ desc }}</a><b>{{ site.name }}</b><c>{{ content }}</c>',
      globals: { desc: 'from-globals' },
      flattenData: true,
      site: { name: 'Real Site' },
    });
    expect(html).toContain('<a>from-front-matter</a>'); // front matter beats globals
    expect(html).toContain('<b>Real Site</b>'); // reserved site not shadowed by front matter
    expect(html).toContain('<c><p>real body</p></c>'); // reserved content = rendered body, not "HIJACK"
    expect(html).not.toContain('HIJACK');
  });
});
