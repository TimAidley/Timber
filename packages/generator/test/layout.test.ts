import { describe, it, expect } from 'vitest';
import { renderPage } from '../src/index.js';

/**
 * Layout inheritance + `{% render %}` snippets (SPEC §6): a page template can extend a
 * base layout via `{% layout %}` and fill only a `{% block %}`, and pull in partials via
 * `{% render %}`. Resolution is against the in-memory `templates` map (no filesystem),
 * so this is the exact mechanism both the browser preview and the Node build rely on.
 */
describe('layout inheritance', () => {
  const markdown = '---\ntitle: My Event\n---\nHello **world**.';

  const base =
    '<!doctype html><html><head><title>{{ page.title }}</title></head>' +
    '<body><header>SITE</header>' +
    '<main>{% block main %}<article><h1>{{ page.title }}</h1>{{ content }}</article>{% endblock %}</main>' +
    '<footer>FOOT</footer></body></html>';

  it('renders a child that overrides only the main block, inheriting the chrome', async () => {
    const child =
      "{% layout 'default' %}{% block main %}" +
      '<article class="event"><h1>{{ page.title }}</h1>{{ content }}</article>' +
      '{% endblock %}';

    const html = await renderPage({
      markdown,
      template: child,
      templates: { default: base },
    });

    // Chrome came from the base layout…
    expect(html).toContain('<header>SITE</header>');
    expect(html).toContain('<footer>FOOT</footer>');
    // …the child's block replaced the default main content…
    expect(html).toContain('<article class="event"><h1>My Event</h1>');
    expect(html).not.toContain('<article><h1>My Event</h1>'); // default block content gone
    // …and the Markdown body still rendered (raw HTML).
    expect(html).toContain('Hello <strong>world</strong>.');
  });

  it('renders the base directly (no layout) with the block’s default content', async () => {
    const html = await renderPage({
      markdown,
      template: base,
      templates: { default: base },
    });
    expect(html).toContain('<article><h1>My Event</h1>');
    expect(html).toContain('<header>SITE</header>');
  });

  it('resolves {% render %} snippets from the templates map', async () => {
    const child = "<div>{% render 'byline', who: page.title %}</div>";
    const html = await renderPage({
      markdown,
      template: child,
      templates: { byline: '<span class="by">by {{ who }}</span>' },
    });
    expect(html).toContain('<div><span class="by">by My Event</span></div>');
  });

  it('still renders a self-contained template when no templates map is given', async () => {
    const html = await renderPage({
      markdown,
      template: '<h1>{{ page.title }}</h1>{{ content }}',
    });
    expect(html).toContain('<h1>My Event</h1>');
    expect(html).toContain('Hello <strong>world</strong>.');
  });
});
