import { describe, it, expect } from 'vitest';
import { importEleventyTemplate } from '../src/importTheme.js';

describe('importEleventyTemplate', () => {
  it('turns a chained layout into {% layout %} + {% block main %}', () => {
    const out = importEleventyTemplate(
      '---\nlayout: layouts/default.liquid\n---\n<h1>{{ title }}</h1>',
    );
    expect(out).toContain("{% layout 'layouts/default' %}"); // subpath kept, extension stripped
    expect(out).toContain('{% block main %}');
    expect(out).toContain('<h1>{{ title }}</h1>');
    expect(out).toContain('{% endblock %}');
  });

  it('converts the root layout’s {{ content }} into an overridable block', () => {
    const out = importEleventyTemplate('<main>{{ content }}</main>', { asRoot: true });
    expect(out).toBe('<main>{% block main %}{% endblock %}</main>');
  });

  it('leaves a non-root {{ content }} as-is (it is the page body)', () => {
    const out = importEleventyTemplate(
      '---\nlayout: base\n---\n<section>{{ content }}</section>',
    );
    expect(out).toContain('<section>{{ content }}</section>');
  });

  it('strips the extension from quoted include/render targets', () => {
    expect(importEleventyTemplate('{% include "css/reset.liquid" %}')).toContain(
      '{% include "css/reset" %}',
    );
    expect(importEleventyTemplate('{% render "navbar.liquid" %}')).toContain(
      '{% render "navbar" %}',
    );
  });

  it('leaves a bare (variable) include target untouched (Eleventy dynamicPartials)', () => {
    expect(importEleventyTemplate('{% include partialName %}')).toContain(
      '{% include partialName %}',
    );
  });

  it('spaces un-spaced tags real themes ship (`{%if%}`)', () => {
    const out = importEleventyTemplate('{%if title %}yes{% endif %}');
    expect(out).toContain('{% if title %}');
  });
});
