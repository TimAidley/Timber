import { describe, it, expect } from 'vitest';
import { importJekyllTemplate, importJekyllTheme } from '../src/importTheme.js';

describe('importJekyllTemplate', () => {
  it('rewrites front-matter layout chaining to {% layout %}/{% block main %}', () => {
    const out = importJekyllTemplate('---\nlayout: base\n---\n<h1>{{ page.title }}</h1>');
    expect(out).toContain("{% layout 'base' %}");
    expect(out).toContain('{% block main %}');
    expect(out).toContain('{% endblock %}');
    expect(out).toContain('<h1>{{ page.title }}</h1>');
  });

  it("turns a parent layout's {{ content }} into the overridable block", () => {
    const out = importJekyllTemplate('<main>{{ content }}</main>', {
      asParentLayout: true,
    });
    expect(out).toBe('<main>{% block main %}{% endblock %}</main>');
  });

  it('keeps {{ content }} as page content in a child layout', () => {
    const out = importJekyllTemplate(
      '---\nlayout: base\n---\n<article>{{ content }}</article>',
    );
    expect(out).toContain('<article>{{ content }}</article>');
  });

  it('converts include syntax and the include.* namespace', () => {
    expect(importJekyllTemplate('{% include head.html %}')).toContain(
      "{% include 'head' %}",
    );
    const nav = importJekyllTemplate('{% include nav-items.html paths = page_paths %}');
    expect(nav).toContain("{% include 'nav-items', paths: page_paths %}");
    // include.foo (Jekyll param namespace) → bare foo (LiquidJS include locals)
    expect(importJekyllTemplate('{% for p in include.paths %}')).toContain(
      '{% for p in paths %}',
    );
  });

  it('handles dynamic-name and bare-variable includes without quoting them', () => {
    // {% include {{ file }} %} → variable (unquoted), not a literal
    expect(importJekyllTemplate('{% include {{ file }} %}')).toContain(
      '{% include file %}',
    );
    // a bare identifier (no extension) is a variable too
    expect(importJekyllTemplate('{% include somevar %}')).toContain(
      '{% include somevar %}',
    );
    // but an extensioned file IS quoted
    expect(importJekyllTemplate('{% include head.html %}')).toContain(
      "{% include 'head' %}",
    );
  });

  it('preserves whitespace-control trim markers on includes', () => {
    expect(importJekyllTemplate('{%- include head.html -%}')).toContain(
      "{%- include 'head' -%}",
    );
  });

  it('drops redundant entity-escaping filters (Timber auto-escapes)', () => {
    expect(importJekyllTemplate('{{ site.title | escape }}')).toBe('{{ site.title }}');
    expect(importJekyllTemplate('{{ x | xml_escape }}')).toBe('{{ x }}');
    expect(importJekyllTemplate('{{ x | escape_once }}')).toBe('{{ x }}');
    // a non-escape filter is untouched
    expect(importJekyllTemplate('{{ x | upcase }}')).toBe('{{ x | upcase }}');
  });
});

describe('importJekyllTheme', () => {
  it('builds a TemplateMap, treating only the named root layout as parent', () => {
    const { templates: map } = importJekyllTheme(
      {
        base: '<main>{{ content }}</main>',
        post: '---\nlayout: base\n---\n<article>{{ content }}</article>',
        head: '<meta>',
      },
      'base',
    );
    expect(map.base).toContain('{% block main %}{% endblock %}'); // parent slot
    expect(map.post).toContain("{% layout 'base' %}"); // child chains up
    expect(map.post).toContain('<article>{{ content }}</article>'); // page content kept
    expect(map.head).toBe('<meta>'); // plain include untouched
  });

  it("collects each layout's front matter (minus layout:) as layoutData", () => {
    const { layoutData } = importJekyllTheme(
      {
        base: '---\nlayout: null\ncommon-css:\n  - "/a.css"\n  - "/b.css"\n---\n<html></html>',
        post: '---\nlayout: base\n---\nbody',
        head: '<meta>',
      },
      'base',
    );
    expect(layoutData.base).toEqual({ 'common-css': ['/a.css', '/b.css'] });
    expect(layoutData.post).toBeUndefined(); // only `layout:` → no data
    expect(layoutData.head).toBeUndefined(); // no front matter
  });
});
