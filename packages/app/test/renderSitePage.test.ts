import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadSchemas, assembleContent, type RepoSnapshot } from '@timber/content';
import { renderSitePage } from '../src/preview/renderSitePage.js';
import { AssetStore } from '../src/state/assets.js';
import type { SiteTheme } from '../src/preview/siteTheme.js';

// Render against the real site-template — the default theme the editor ships — so this
// exercises the whole preview path: template resolution, site/nav/seo assembly (the same
// @timber/content helpers the CLI build uses), and theme inlining.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../site-template');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

function fixture(): { model: ReturnType<typeof assembleContent>; theme: SiteTheme } {
  const snapshot: RepoSnapshot = new Map([
    ['config/schemas/pages.yml', read('config/schemas/pages.yml')],
    ['config/schemas/settings.yml', read('config/schemas/settings.yml')],
    ['content/settings/index.md', read('content/settings/index.md')],
    ['content/pages/home/index.md', read('content/pages/home/index.md')],
    ['content/pages/about/index.md', read('content/pages/about/index.md')],
  ]);
  const schemas = loadSchemas(snapshot);
  const model = assembleContent(snapshot, schemas);
  const theme: SiteTheme = {
    templates: new Map([['default.liquid', read('templates/default.liquid')]]),
    css: read('assets/theme.css'),
    navigationYml: read('config/navigation.yml'),
    objectUrls: [],
  };
  return { model, theme };
}

const home = (model: ReturnType<typeof assembleContent>) =>
  model.objects.find((o) => o.path === 'content/pages/home/index.md')!;

describe('renderSitePage', () => {
  it('renders a page through the site’s own template + theme', async () => {
    const { model, theme } = fixture();
    const object = home(model);
    const html = await renderSitePage({
      model,
      object,
      schema: model.schemas.get(object.type)!,
      data: object.data,
      body: object.body,
      theme,
      assetStore: new AssetStore(),
    });

    // Full page shell from the site's template (not the old placeholder <article>).
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('class="site-header"');
    // The theme is inlined; the unreachable <link href=.../assets/theme.css> is gone.
    expect(html).toContain('<style data-timber-theme>');
    expect(html).not.toContain('assets/theme.css');
    // Nav resolved from navigation.yml through the id index (labels + resolved hrefs).
    expect(html).toContain('>Home</a>');
    expect(html).toContain('>About</a>');
    // Live title in <head>/<h1> and the rendered Markdown body.
    expect(html).toContain('Welcome');
    expect(html).toContain('<strong>Timber</strong>');
  });

  it('reflects live front-matter edits, not the stored copy', async () => {
    const { model, theme } = fixture();
    const object = home(model);
    const html = await renderSitePage({
      model,
      object,
      schema: model.schemas.get(object.type)!,
      data: { ...object.data, title: 'Edited In Preview' },
      body: object.body,
      theme,
      assetStore: new AssetStore(),
    });
    expect(html).toContain('Edited In Preview');
  });

  it('throws a helpful error when no template resolves', async () => {
    const { model } = fixture();
    const object = home(model);
    const empty: SiteTheme = { templates: new Map(), css: '', navigationYml: null, objectUrls: [] };
    await expect(
      renderSitePage({
        model,
        object,
        schema: model.schemas.get(object.type)!,
        data: object.data,
        body: object.body,
        theme: empty,
        assetStore: new AssetStore(),
      }),
    ).rejects.toThrow(/default\.liquid/);
  });
});
