import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importThemeToRepo, parseImportArgs } from '../src/importTheme.node.js';
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

  it('wires a content type to a specific layout via --map, and builds through it', async () => {
    const repo2 = await mkdtemp(join(tmpdir(), 'timber-map-'));
    const r = await importThemeToRepo(THEME, repo2, { typeMap: { posts: 'post' } });
    expect(r.mapped).toEqual({ posts: 'post' });
    expect(r.templates).toContain('templates/posts.liquid');
    // posts.liquid IS the post layout (article wrapper) chained to base.
    const postsTemplate = await readFile(join(repo2, 'templates/posts.liquid'), 'utf8');
    expect(postsTemplate).toContain('class="post h-entry"');

    const w = async (rel: string, content: string): Promise<void> => {
      await mkdir(dirname(join(repo2, rel)), { recursive: true });
      await writeFile(join(repo2, rel), content, 'utf8');
    };
    await w(
      'config/schemas/settings.yml',
      'kind: singleton\npage: false\nhasBody: false\nfields:\n  title: { type: text }\n  baseUrl: { type: text }\n',
    );
    await w(
      'config/schemas/posts.yml',
      'kind: collection\nhasBody: true\nfields:\n  title:\n    type: text\n    required: true\n  date:\n    type: datetime\n',
    );
    await w(
      'content/settings/index.md',
      '---\ntitle: T\nbaseUrl: https://ex.test/mysite\n---\n',
    );
    await w(
      'content/posts/hi/index.md',
      '---\ntitle: Hi There\ndate: 2026-05-02T09:00:00Z\npublic: true\n---\n\nBody.\n',
    );

    const out = await mkdtemp(join(tmpdir(), 'timber-map-out-'));
    await buildSite(repo2, out);
    const html = await readFile(join(out, 'posts', 'hi', 'index.html'), 'utf8');
    expect(html).toContain('class="post h-entry"'); // rendered through the post layout, not default
    expect(html).toContain('Hi There');
    expect(html).not.toContain('{%');
  });

  it('rejects a --map to a non-existent layout', async () => {
    const repo3 = await mkdtemp(join(tmpdir(), 'timber-map-bad-'));
    await expect(
      importThemeToRepo(THEME, repo3, { typeMap: { posts: 'nope' } }),
    ).rejects.toThrow(/no layout "nope"/);
  });
});

describe('parseImportArgs', () => {
  it('parses repeatable and comma-separated --map into a type→layout map', () => {
    expect(
      parseImportArgs(['theme', 'repo', '--map', 'posts=post', '--map', 'events=event']),
    ).toEqual({
      positionals: ['theme', 'repo'],
      typeMap: { posts: 'post', events: 'event' },
    });
    expect(parseImportArgs(['--map=posts=post,events=event', 'theme', 'repo'])).toEqual({
      positionals: ['theme', 'repo'],
      typeMap: { posts: 'post', events: 'event' },
    });
  });

  it('returns an empty typeMap when no --map is given', () => {
    expect(parseImportArgs(['theme', 'repo'])).toEqual({
      positionals: ['theme', 'repo'],
      typeMap: {},
    });
  });
});
