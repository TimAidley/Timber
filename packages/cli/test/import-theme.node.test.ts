import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importThemeToRepo } from '../src/importTheme.node.js';
import { buildSite } from '../src/build.node.js';

/**
 * End-to-end proof of the **adopt-once** loop: import the real Minima theme into a fresh repo,
 * then run the actual `timber build` over that repo + a little content, and confirm the built
 * HTML is styled by the imported theme. This exercises everything together — the transform,
 * the Sass compile, and Timber's own build reading the written `templates/*.liquid`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const THEME = join(here, 'fixtures', 'minima-theme');

let repo: string;
let result: Awaited<ReturnType<typeof importThemeToRepo>>;

async function write(rel: string, content: string): Promise<void> {
  await mkdir(dirname(join(repo, rel)), { recursive: true });
  await writeFile(join(repo, rel), content, 'utf8');
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'timber-import-'));
  result = await importThemeToRepo(THEME, repo);

  // A minimal content repo alongside the imported theme.
  await write(
    'config/schemas/settings.yml',
    'kind: singleton\npage: false\nhasBody: false\nfields:\n  title: { type: text }\n  description: { type: text }\n  baseUrl: { type: text }\n',
  );
  await write(
    'config/schemas/pages.yml',
    'kind: collection\nhasBody: true\nfields:\n  title:\n    type: text\n    required: true\n',
  );
  await write(
    'content/settings/index.md',
    '---\ntitle: Larch & Pine\ndescription: Notes on timber\nbaseUrl: https://example.github.io/mysite\n---\n',
  );
  await write(
    'content/pages/about/index.md',
    '---\ntitle: About\npublic: true\n---\n\nWoodworker and **tree nerd**.\n',
  );
});

describe('importThemeToRepo (adopt-once)', () => {
  it('writes native templates for every layout + include', () => {
    for (const name of [
      'default',
      'base',
      'post',
      'page',
      'home',
      'head',
      'header',
      'footer',
    ]) {
      expect(result.templates).toContain(`templates/${name}.liquid`);
    }
    // Minima's root is `base`; its generic single-content layout `page` becomes the fallback.
    expect(result.rootLayout).toBe('base');
    expect(result.defaultLayout).toBe('page');
  });

  it('the written templates are the real theme, lightly adapted', async () => {
    const base = await readFile(join(repo, 'templates/base.liquid'), 'utf8');
    expect(base).toContain('{% block main %}{% endblock %}'); // parent slot
    expect(base).toContain("include 'header'"); // converted include (trim markers vary)
    const post = await readFile(join(repo, 'templates/post.liquid'), 'utf8');
    expect(post).toContain("{% layout 'base' %}"); // chained to root
    expect(post).toContain('class="post h-entry"'); // real Minima markup, untouched
  });

  it('compiles the theme SCSS to CSS (skin @import resolved, no Liquid left)', async () => {
    expect(result.compiled).toContain('assets/css/style.css');
    const css = await readFile(join(repo, 'assets/css/style.css'), 'utf8');
    expect(css).toContain('.site-header');
    expect(css).not.toContain('@import');
    expect(css).not.toContain('{{');
  });

  it('timber build produces a page styled by the imported theme', async () => {
    const out = await mkdtemp(join(tmpdir(), 'timber-out-'));
    const built = await buildSite(repo, out);
    expect(built.pages).toBeGreaterThanOrEqual(1);

    const html = await readFile(join(out, 'pages', 'about', 'index.html'), 'utf8');
    expect(html).toContain('class="site-header"'); // theme chrome (base → header include)
    expect(html).toContain('/mysite/assets/css/style.css'); // compiled stylesheet, base-pathed
    expect(html).toContain('About'); // the page title
    expect(html).toContain('<strong>tree nerd</strong>'); // markdown body rendered
    expect(html).not.toContain('{%'); // no unresolved Liquid
  });
});
