import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/index.js';

/**
 * The `markdownify` filter (SPEC §13). Only the page body is Markdown by default — every
 * other value is escaped on output — so a settings field a site owner wants to write in
 * Markdown (the footer copyright, a tagline) opts in through this filter.
 *
 * It runs the ordinary SPEC §6 pipeline, so what a field gets is exactly what a body gets:
 * the same directives, the same sanitising. These tests pin both halves of that promise —
 * the capability, and the safety it inherits.
 */
const engine = createEngine();

/** Render a one-expression template, the way a theme would use the filter. */
function render(template: string, scope: Record<string, unknown>): Promise<string> {
  return engine.parseAndRender(template, scope);
}

describe('markdownify', () => {
  it('renders a one-line field inline, with no paragraph wrapper to nest', async () => {
    const html = await render('<p>{{ site.copyright | markdownify }}</p>', {
      site: { copyright: '© 2026 Acme' },
    });
    expect(html).toBe('<p>© 2026 Acme</p>');
  });

  it('renders Markdown in the field — the point of the filter', async () => {
    const html = await render('{{ s | markdownify }}', {
      s: 'Built by [Acme](/about) with *care*',
    });
    expect(html).toContain('<a href="/about">Acme</a>');
    expect(html).toContain('<em>care</em>');
  });

  it('expands the :timber-logo shortcode, so the wordmark works outside the body', async () => {
    const html = await render('{{ s | markdownify }}', {
      s: '© 2026 — built with :timber-logo',
    });
    expect(html).toContain(
      '<span class="wordmark"><span class="wordmark__tim">Tim</span>ber</span>',
    );
  });

  it('keeps blocks when the field genuinely has more than one', async () => {
    const html = await render('{{ s | markdownify }}', {
      s: 'First line.\n\nSecond line.\n',
    });
    expect(html).toContain('<p>First line.</p>');
    expect(html).toContain('<p>Second line.</p>');
  });

  it('does not unwrap a single block that is not a paragraph', async () => {
    const html = await render('{{ s | markdownify }}', { s: '- one\n- two\n' });
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
  });

  it('sanitises raw HTML in the field, exactly as it would in a body', async () => {
    const html = await render('{{ s | markdownify }}', {
      s: 'hi <script>alert(1)</script> <img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror');
  });

  it('strips a javascript: link protocol', async () => {
    const html = await render('{{ s | markdownify }}', { s: '[x](javascript:alert(1))' });
    expect(html).not.toContain('javascript:');
  });

  it('emits the rendered HTML raw, not double-escaped', async () => {
    const html = await render('{{ s | markdownify }}', { s: '*yes*' });
    expect(html).toBe('<em>yes</em>');
    expect(html).not.toContain('&lt;');
  });

  it('leaves every other output escaped — the filter is the only opt-in', async () => {
    const html = await render('{{ s }}', { s: '<em>no</em>' });
    expect(html).toBe('&lt;em&gt;no&lt;/em&gt;');
  });

  it('renders a missing or empty field as nothing, not "undefined"', async () => {
    expect(await render('{{ nope | markdownify }}', {})).toBe('');
    expect(await render('{{ s | markdownify }}', { s: '' })).toBe('');
  });
});

describe('markdownify_block', () => {
  it('keeps the paragraph wrapper a single-paragraph field would otherwise lose', async () => {
    const html = await render('{{ s | markdownify_block }}', { s: 'Just one line.' });
    expect(html.trim()).toBe('<p>Just one line.</p>');
  });

  it('matches markdownify once there is more than one block', async () => {
    const scope = { s: 'One.\n\nTwo.\n' };
    const block = await render('{{ s | markdownify_block }}', scope);
    const inline = await render('{{ s | markdownify }}', scope);
    expect(block).toBe(inline);
  });
});
