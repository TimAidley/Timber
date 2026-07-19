// THROWAWAY SPIKE — render the REAL Minima theme through Timber's generator.
//
// Proves the audit's thesis end-to-end: with the native Tier-1 changes (page.url,
// relative_url/absolute_url — now in @timber/generator) plus a thin compat shim
// (jekyllCompat.mjs) and a mechanical import transform (importJekyllTemplate.mjs), the
// UNMODIFIED Minima `_layouts` + `_includes` render real content pages via Timber's own
// content APIs (siteContext / assembleCollections / pageSeo / urlFor / withCollectionAliases).
//
// Run: `node spike/jekyll-minima/render.mjs`  (writes spike/jekyll-minima/_site/).

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  parseFrontMatter,
  renderMarkdown,
  createEngine,
  SafeHtml,
} from '@timber/generator';
import {
  siteContext,
  pageSeo,
  urlFor,
  assembleCollections,
  withCollectionAliases,
} from '@timber/content';
import { registerJekyllCompat } from './jekyllCompat.mjs';
import { importJekyllTemplate } from './importJekyllTemplate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// Real Minima source, vendored under minima-src/ (MIT — see minima-src/LICENSE.txt), so the
// spike is self-contained and reproducible. Override with MINIMA_DIR to point at a fresh clone.
const THEME = process.env.MINIMA_DIR || join(here, 'minima-src');
const OUT = join(here, '_site');

// ── 1. Import the REAL Minima templates → a Timber bare-name template map ──────────────
async function readTheme(rel) {
  return readFile(join(THEME, rel), 'utf8');
}

async function buildTemplateMap() {
  const map = {};
  // base is the root layout (its {{ content }} → {% block main %}); the rest are children.
  map.base = importJekyllTemplate(await readTheme('_layouts/base.html'), { asParentLayout: true });
  for (const name of ['home', 'post', 'page']) {
    map[name] = importJekyllTemplate(await readTheme(`_layouts/${name}.html`));
  }
  // Every include, transformed (include syntax + include.* namespace), keyed by bare name.
  for (const file of await readdir(join(THEME, '_includes'))) {
    if (!file.endsWith('.html')) continue;
    map[file.replace(/\.html$/, '')] = importJekyllTemplate(await readTheme(`_includes/${file}`));
  }
  return map;
}

// ── 2. A tiny content model, exactly the shape Timber's own APIs consume ───────────────
const schemas = new Map([
  ['site-settings', { name: 'site-settings', kind: 'singleton', page: false, fields: {} }],
  ['posts', { name: 'posts', kind: 'collection', fields: {
    title: { type: 'text' }, date: { type: 'datetime' }, excerpt: { type: 'text' },
  } }],
  ['pages', { name: 'pages', kind: 'collection', fields: { title: { type: 'text' } } }],
]);

const settingsObject = {
  type: 'site-settings', kind: 'singleton', slug: 'site-settings',
  path: 'content/site-settings/index.md', body: '',
  data: {
    title: 'Larch & Pine',
    description: 'Field notes on trees, timber, and quiet woodwork.',
    baseUrl: 'https://example.github.io/mysite',
    author: { name: 'A. Woodward', email: 'a@example.com' },
    minima: {
      date_format: '%b %-d, %Y',
      social_links: [{ title: 'GitHub', icon: 'github', url: 'https://github.com/example' }],
    },
  },
};

// Two posts + a homepage + an about page — ordinary bundles with real Markdown bodies.
// `public: true` — collections carry only *published* objects (draft-by-default, SPEC §5).
const posts = [
  { slug: 'why-larch', data: { title: 'Why Larch Outlasts the Weather', date: '2026-05-02T09:00:00Z', public: true },
    body: '## The short of it\n\nLarch is **naturally rot-resistant**. A few notes on why, and how to season it.\n\n- Tight grain\n- High resin\n- Ages to silver' },
  { slug: 'first-plane', data: { title: 'Setting Up Your First Hand Plane', date: '2026-06-18T09:00:00Z', public: true },
    body: 'A hand plane is _mostly_ setup. Get the iron flat, the mouth tight, and the sole true.\n\n> Sharp beats strong.' },
].map((p) => ({ type: 'posts', kind: 'collection', id: `post-${p.slug}`, slug: p.slug,
  path: `content/posts/${p.slug}/index.md`, ...p }));

const homeObject = { type: 'pages', kind: 'collection', id: 'home', slug: 'home',
  path: 'content/pages/home/index.md',
  data: { title: 'Larch & Pine', list_title: 'Latest notes', public: true },
  body: 'Welcome — a small workshop journal.' };

const aboutObject = { type: 'pages', kind: 'collection', id: 'about', slug: 'about',
  path: 'content/pages/about/index.md', data: { title: 'About', public: true },
  body: 'Woodworker, tree nerd, occasional writer.' };

const objects = [settingsObject, ...posts, homeObject, aboutObject];
// assembleContent normally derives `object.public` from front matter; we hand-build objects,
// so mirror that (isPublic reads the top-level flag; collections carry only public objects).
for (const o of objects) o.public = o.data.public === true;
const model = { objects, schemas };

// ── 3. Build the render context with Timber's REAL content APIs ────────────────────────
// Homepage-at-root routing (SPEC §5), same as the CLI build.
const HOME_ID = 'home';
const effectiveUrl = (o, s) => (o.id === HOME_ID ? '/' : urlFor(o, s));

const now = new Date('2026-07-19T00:00:00Z');
const nowIso = now.toISOString();
const today = nowIso.slice(0, 10);

let site = siteContext(settingsObject); // settings + baseUrl + basePath (/mysite) + themeStyle
const collections = assembleCollections(model, effectiveUrl);
// Minima's header builds nav from `site.pages | map: "path"`; give each page entry a `path`
// (the audit's "re-express nav" — one computed field over the pages collection).
for (const entry of collections.pages ?? []) entry.path = entry.url;
site = withCollectionAliases(site, collections, nowIso); // site.posts / site.pages / site.time

// ── 4. One compat-augmented engine, then render each object ────────────────────────────
const templates = await buildTemplateMap();
const engine = createEngine(templates); // native: relative_url/absolute_url + comparison filters
registerJekyllCompat(engine); // + Jekyll ecosystem: date_to_xmlschema, {% seo %}, …

async function renderObject(object, entryTemplate) {
  const schema = schemas.get(object.type);
  const url = effectiveUrl(object, schema);
  const content = await renderMarkdown(object.body);
  const seo = pageSeo(object, schema, site);
  if (object.id === HOME_ID) seo.canonical = `${site.baseUrl}/`;
  const html = await engine.parseAndRender(templates[entryTemplate], {
    page: { ...object.data, url, collection: object.type, content: new SafeHtml(content) },
    content: new SafeHtml(content),
    site, collections, seo, now: nowIso, today,
  });
  return { url, html };
}

const targets = [
  [homeObject, 'home'],
  [posts[0], 'post'],
  [posts[1], 'post'],
  [aboutObject, 'page'],
];

const rendered = [];
for (const [object, tmpl] of targets) {
  const { url, html } = await renderObject(object, tmpl);
  const dir = join(OUT, url.replace(/^\/+|\/+$/g, ''));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), html, 'utf8');
  rendered.push({ url, html });
  console.log(`  rendered ${url}  (${html.length} bytes)`);
}

// ── 5. Compile Minima's SCSS → CSS (the audit's "pre-compile the skin" path) ───────────
const exec = promisify(execFile);
async function compileCss() {
  const scssSrc = await readTheme('assets/css/style.scss');
  // The SCSS front matter + a Liquid-interpolated skin @import (`{{ site.minima.skin }}`):
  // resolve the skin to 'classic' (audit §6) and drop the front matter, then let dart-sass
  // (pure JS, no native dep — fits SPEC §2) resolve @imports against the theme's _sass dir.
  const resolved = scssSrc
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/\{\{[^}]*skin[^}]*\}\}/g, 'classic');
  const tmpScss = join(here, '_style.resolved.scss');
  await writeFile(tmpScss, resolved, 'utf8');
  await mkdir(join(OUT, 'assets', 'css'), { recursive: true });
  await exec('npx', ['--yes', 'sass', '--load-path', join(THEME, '_sass'),
    tmpScss, join(OUT, 'assets', 'css', 'style.css')]);
}

let cssOk = false;
try { await compileCss(); cssOk = true; console.log('  compiled assets/css/style.css'); }
catch (e) { console.log(`  (skipped CSS: ${String(e.message).split('\n')[0]})`); }

// ── 6. Assertions — the proof ─────────────────────────────────────────────────────────
const home = rendered.find((r) => r.url === '/').html;
const post = rendered.find((r) => r.url === '/posts/why-larch/').html;
const checks = [
  ['home lists post titles', home.includes('Why Larch Outlasts the Weather') && home.includes('Setting Up Your First Hand Plane')],
  ['home post links carry the /mysite base path (relative_url)', home.includes('href="/mysite/posts/why-larch/"')],
  ['stylesheet link is base-pathed', home.includes('href="/mysite/assets/css/style.css"')],
  ['site.pages nav renders the About link', home.includes('/mysite/pages/about/') && home.includes('>About<')],
  ['no double-escaping from theme | escape + Timber auto-escape', home.includes('Larch &amp; Pine') && !home.includes('&amp;amp;')],
  ['{% seo %} emitted the title from Timber\'s seo bag', home.includes('<title>') && home.includes('Larch &amp; Pine')],
  ['post shows strftime-formatted date (%b %-d, %Y)', post.includes('May 2, 2026')],
  ['post date_to_xmlschema is ISO', post.includes('datetime="2026-05-02T09:00:00.000Z"')],
  ['post body Markdown rendered to HTML', post.includes('<strong>naturally rot-resistant</strong>')],
  ['page.url injected (u-url self link, base-pathed)', post.includes('href="/mysite/posts/why-larch/"')],
  ['no unresolved Liquid tags left', !home.includes('{%') && !post.includes('{%')],
  ['no unresolved Liquid outputs left', !home.includes('{{') && !post.includes('{{')],
];

console.log('\nAssertions:');
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed++;
}
console.log(`\n${failed === 0 ? '✅ ALL PASS' : `❌ ${failed} FAILED`} · CSS: ${cssOk ? 'compiled' : 'skipped'} · ${rendered.length} pages → spike/jekyll-minima/_site/`);
process.exit(failed === 0 ? 0 : 1);
