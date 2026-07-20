import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { renderPage } from '@timber/generator';
import { planThemeImport, type ThemeFiles } from '@timber/jekyll-compat';
import { eleventyEngine } from '../src/engine.js';
import { registerEleventyCompat } from '../src/register.js';

/**
 * End-to-end proof of the Eleventy-Liquid adopt path: plan the real **nulite** theme through
 * the shared `planThemeImport` with the Eleventy engine, then render its sample post through
 * Timber's own `renderPage` (with the flat data cascade + the ecosystem filter shims) and
 * confirm the theme's chrome + styling come through — the spike, as a real test.
 */
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', 'nulite');

function loadThemeFiles(dir: string): ThemeFiles {
  const text: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else text[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return { text };
}

describe('eleventyEngine.collect', () => {
  const theme = loadThemeFiles(FIXTURE);
  const { templates, rootLayout, defaultLayout } = eleventyEngine.collect(theme, {});

  it('detects the root layout (chain target with no own layout)', () => {
    expect(rootLayout).toBe('layouts/default');
  });

  it('picks the post layout as the per-type default', () => {
    expect(defaultLayout).toBe('layouts/post');
  });

  it('collects every _includes template keyed by bare relative path', () => {
    for (const k of ['layouts/default', 'layouts/post', 'navbar', 'footer', 'css/global']) {
      expect(templates[k]).toBeDefined();
    }
  });

  it('transforms the chained post layout and the root layout', () => {
    expect(templates['layouts/post']).toContain("{% layout 'layouts/default' %}");
    expect(templates['layouts/default']).toContain('{% block main %}{% endblock %}'); // {{content}}
    expect(templates['layouts/default']).toContain('{% include "navbar" %}'); // ext stripped
  });
});

describe('eleventyEngine.globals', () => {
  it('parses _data/*.json and skips _data/*.js', () => {
    const g = eleventyEngine.globals!(loadThemeFiles(FIXTURE));
    expect(g.metadata).toEqual({ author: 'Diego', buildYear: 2023 });
    expect(g.site).toBeUndefined(); // site.js is JavaScript — not statically parseable
  });
});

describe('planThemeImport with the Eleventy engine', () => {
  const plan = planThemeImport(loadThemeFiles(FIXTURE), {
    engine: eleventyEngine,
    themeName: 'nulite',
  });

  it('writes templates under themes/<name>/templates, keeping subpaths', () => {
    expect(plan.engine).toBe('eleventy');
    expect(plan.templates['themes/nulite/templates/layouts/default.liquid']).toBeDefined();
    expect(plan.templates['themes/nulite/templates/navbar.liquid']).toBeDefined();
    // The per-type fallback = the post layout.
    expect(plan.templates['themes/nulite/templates/default.liquid']).toContain(
      "{% layout 'layouts/default' %}",
    );
  });

  it('writes a theme.json manifest declaring the engine + parsed data globals', () => {
    const manifest = plan.textFiles['themes/nulite/theme.json'];
    expect(manifest).toBeDefined();
    const parsed = JSON.parse(manifest!);
    expect(parsed.engine).toBe('eleventy');
    expect(parsed.data.metadata).toEqual({ author: 'Diego', buildYear: 2023 });
  });
});

describe('render the imported nulite post (preview ≡ build path)', () => {
  let html: string;
  beforeAll(async () => {
    const plan = planThemeImport(loadThemeFiles(FIXTURE), {
      engine: eleventyEngine,
      themeName: 'nulite',
    });
    // Reconstruct the bare-name template map exactly as the build does.
    const prefix = 'themes/nulite/templates/';
    const templates: Record<string, string> = {};
    for (const [path, src] of Object.entries(plan.templates)) {
      templates[path.slice(prefix.length, -'.liquid'.length)] = src;
    }
    const globals = JSON.parse(plan.textFiles['themes/nulite/theme.json']!).data;
    const markdown = readFileSync(join(FIXTURE, 'posts', 'sample-article.md'), 'utf8');
    html = await renderPage({
      markdown,
      template: templates['default']!, // = the post layout (per-type fallback)
      templates,
      site: { title: 'Nulite starter for Eleventy', shortTitle: 'Nulite starter 💊' },
      collections: { posts: [] },
      globals,
      flattenData: true,
      extend: registerEleventyCompat,
    });
  });

  it('renders the full themed document with the post + chrome', () => {
    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toMatch(/<h1 class="post-title">\s*Sample article/); // bare {{title}} via cascade
    expect(html).toContain('<title>Sample article</title>'); // front-matter fallback branch
    expect(html).toContain('<strong>bold text</strong>'); // markdown body ({{ content }})
    expect(html).toContain('Nulite starter 💊'); // navbar include reads site.shortTitle
    expect(html).toContain('class="footer"'); // footer include
    expect(html).toContain('data-theme-toggle'); // nested include (dark-toggler)
    expect(html).toContain('--color-primary: #147d82'); // inline theme CSS include
    expect(html).toContain('--prism-foreground'); // prism CSS include (chained layout)
    expect(html).toMatch(/Thu, Sep 14, 2023/); // LiquidJS date strftime filter
  });

  it('leaves no unresolved Liquid', () => {
    expect(html).not.toContain('{%');
    expect(html).not.toContain('{{');
  });
});
