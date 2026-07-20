import { describe, it, expect } from 'vitest';
import { planThemeImport } from '../src/planImport.js';

describe('planThemeImport', () => {
  const theme = {
    text: {
      '_layouts/base.html': '<main>{{ content }}</main>',
      '_layouts/post.html': '---\nlayout: base\n---\n<article>{{ content }}</article>',
      '_layouts/page.html': '---\nlayout: base\n---\n<div>{{ content }}</div>',
      '_includes/head.html': '<meta>',
      'assets/css/style.scss': '---\n---\na{color:red}',
      'assets/js/app.js': 'console.log(1)',
      '_sass/_vars.scss': '$c: red;',
    },
    binary: { 'assets/img/logo.png': new Uint8Array([1, 2, 3]) },
  };

  it('plans templates, detecting root + default layouts', () => {
    const plan = planThemeImport(theme);
    expect(plan.rootLayout).toBe('base');
    expect(plan.defaultLayout).toBe('page'); // no `default` layout → `page` is the fallback
    expect(plan.templates['templates/base.liquid']).toContain(
      '{% block main %}{% endblock %}',
    );
    expect(plan.templates['templates/post.liquid']).toContain("{% layout 'base' %}");
    expect(plan.templates['templates/head.liquid']).toBe('<meta>');
    expect(plan.templates['templates/default.liquid']).toContain('<div>'); // = the page layout
  });

  it('routes assets and maps _sass/ under assets/_sass/', () => {
    const plan = planThemeImport(theme);
    expect(plan.textFiles['assets/css/style.scss']).toContain('a{color:red}'); // SCSS source, uncompiled
    expect(plan.textFiles['assets/js/app.js']).toBe('console.log(1)');
    expect(plan.textFiles['assets/_sass/_vars.scss']).toBe('$c: red;'); // _sass → assets/_sass
    expect(plan.binaryFiles['assets/img/logo.png']).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('applies a typeMap (type → layout)', () => {
    const plan = planThemeImport(theme, { typeMap: { posts: 'post' } });
    expect(plan.templates['templates/posts.liquid']).toContain("{% layout 'base' %}");
    expect(plan.mapped).toEqual({ posts: 'post' });
  });

  it('throws when the theme has no _layouts', () => {
    expect(() => planThemeImport({ text: { 'assets/x.css': 'a{}' } })).toThrow(
      /_layouts/,
    );
  });

  it('throws on a typeMap to a missing layout', () => {
    expect(() => planThemeImport(theme, { typeMap: { posts: 'nope' } })).toThrow(
      /no layout "nope"/,
    );
  });

  it('writes the whole plan under themes/<name>/ when given a themeName (SPEC §13)', () => {
    const plan = planThemeImport(theme, { themeName: 'minima', typeMap: { posts: 'post' } });
    expect(plan.themeName).toBe('minima');
    // Templates and assets alike carry the theme-folder prefix.
    expect(plan.templates['themes/minima/templates/base.liquid']).toBeDefined();
    expect(plan.templates['themes/minima/templates/default.liquid']).toBeDefined();
    expect(plan.templates['themes/minima/templates/posts.liquid']).toBeDefined();
    expect(plan.textFiles['themes/minima/assets/css/style.scss']).toContain('a{color:red}');
    expect(plan.textFiles['themes/minima/assets/_sass/_vars.scss']).toBe('$c: red;');
    expect(plan.binaryFiles['themes/minima/assets/img/logo.png']).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    // Nothing leaks to the legacy root.
    expect(plan.templates['templates/base.liquid']).toBeUndefined();
  });

  it('leaves themeName null (legacy root) when no name is given', () => {
    expect(planThemeImport(theme).themeName).toBeNull();
  });
});
