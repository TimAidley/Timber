import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { renderPage, buildClock, createEngine } from '@timber/generator';
import { registerJekyllCompat } from '@timber/jekyll-compat';
import { compileScss } from '@timber/sass';
import {
  aliasUrls,
  assembleCollections,
  assembleContent,
  loadSchemas,
  loadNavigation,
  buildRobots,
  buildSitemap,
  canPublish,
  hreflangAlternates,
  isPublic,
  pageSeo,
  redirectStubHtml,
  siteContext,
  translationsOf,
  urlFor,
  Validator,
  THEMES_DIR,
  resolveThemePaths,
  assetSourceDirs,
  assetOutputPath,
  type ContentObject,
  type ContentTypeSchema,
} from '@timber/content';
import { buildSnapshotFromDir } from './snapshot.node.js';

export interface BuildResult {
  pages: number;
  drafts: number;
  assets: number;
  redirects: number;
}

/** Thrown when the site can't be built — a broken site must never deploy (SPEC §12). */
export class BuildError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Build failed with ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`,
    );
    this.name = 'BuildError';
  }
}

/** All files (recursive, posix-relative to `absDir`); [] if the directory is absent. */
async function walkFiles(absDir: string, base = absDir): Promise<string[]> {
  const entries = await readdir(absDir, { withFileTypes: true }).catch(() => null);
  if (!entries) return [];
  const out: string[] = [];
  for (const entry of entries) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(abs, base)));
    else out.push(relative(base, abs).split(sep).join('/'));
  }
  return out;
}

async function copyFile(fromAbs: string, toAbs: string): Promise<void> {
  await mkdir(dirname(toAbs), { recursive: true });
  await writeFile(toAbs, await readFile(fromAbs));
}

/** Strip leading/trailing slashes so a URL becomes an output path segment. */
function urlToDir(url: string): string {
  return url.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Build the whole static site from a content repo (SPEC §12) — the Node/CI entry
 * point that turns published source into deployable HTML. This is the full-site
 * counterpart to the single-page `render` command; it runs the SAME `renderPage`
 * the browser preview uses, so preview ≡ build.
 *
 * Renders every **public** object (drafts are omitted from the live build), fails
 * the build if any public object is invalid or the model has structural errors (so
 * the last good deploy stays live), and copies site-wide + colocated assets.
 */
export async function buildSite(repoDir: string, outDir: string): Promise<BuildResult> {
  const snapshot = await buildSnapshotFromDir(repoDir);
  const schemas = loadSchemas(snapshot);
  const model = assembleContent(snapshot, schemas);
  const validator = new Validator(schemas);

  // Validity gate: structural problems + any invalid *public* object block the build.
  const problems: string[] = model.errors.map((e) => `[${e.kind}] ${e.message}`);
  for (const object of model.objects) {
    if (!isPublic(object)) continue;
    const result = validator.validateObject(object, model);
    if (!canPublish(result)) {
      const detail = result.errors
        .map((e) => `${e.field ? `${e.field}: ` : ''}${e.message}`)
        .join('; ');
      problems.push(`invalid public object ${object.path}: ${detail}`);
    }
  }
  if (problems.length > 0) throw new BuildError(problems);

  // Site-wide context from the global-settings singleton (SPEC §13): the config
  // object whose type is marked `page: false`. It's read for `{{ site }}` but never
  // rendered as a page.
  const settingsObject = model.objects.find((o) => schemas.get(o.type)?.page === false);
  const site = siteContext(settingsObject);

  // Resolve the active theme (SPEC §13): its templates + assets live under
  // `themes/<name>/`, selected by the settings singleton's `activeTheme`. A site with no
  // active theme — or a dangling one whose folder was deleted — uses the legacy root
  // (`templates/` + `assets/`) unchanged, so every pre-themes site builds exactly as before.
  const activeTheme = typeof site.activeTheme === 'string' ? site.activeTheme : undefined;
  const themeHasTemplates =
    activeTheme !== undefined &&
    (await walkFiles(join(repoDir, THEMES_DIR, activeTheme, 'templates'))).some((r) =>
      r.endsWith('.liquid'),
    );
  const theme = resolveThemePaths(activeTheme, () => themeHasTemplates);

  // Load every template once, keyed by **bare name** (no `.liquid`), so a page template
  // can `{% layout %}` / `{% render %}` any other template (SPEC §6 layout inheritance +
  // snippets). Nested files keep their subpath (`partials/card.liquid` → `partials/card`),
  // matching how LiquidJS resolves `{% render 'partials/card' %}`. This same map is handed
  // to every `renderPage` so the browser preview (which loads the same set) stays ≡ build.
  const templates: Record<string, string> = {};
  for (const rel of await walkFiles(join(repoDir, theme.templatesDir))) {
    if (!rel.endsWith('.liquid')) continue;
    templates[rel.slice(0, -'.liquid'.length)] = await readFile(
      join(repoDir, theme.templatesDir, rel),
      'utf8',
    );
  }

  /** The entry (child) template for a type: `<theme>/<type>.liquid` → `default.liquid`. */
  function resolveTemplate(type: string): string {
    const source = templates[type] ?? templates['default'];
    if (source === undefined) {
      throw new BuildError([
        `no template for type "${type}" (${theme.templatesDir}/${type}.liquid or ${theme.templatesDir}/default.liquid)`,
      ]);
    }
    return source;
  }

  // Homepage-at-root (SPEC §5): the settings singleton names a `homepage` object id;
  // that object renders to `/` instead of its normal `/type/slug/` URL.
  const homepageId = typeof site.homepage === 'string' ? site.homepage : undefined;
  const effectiveUrl = (object: ContentObject, schema: ContentTypeSchema): string =>
    homepageId && object.id === homepageId ? '/' : urlFor(object, schema);

  // Manual navigation (SPEC §13): resolve `ref` entries through the same effective URL.
  site.nav = loadNavigation(snapshot, (id) => {
    const target = model.byId.get(id);
    const schema = target && schemas.get(target.type);
    return target && schema ? effectiveUrl(target, schema) : undefined;
  });

  // Per-type collections for listing loops (SPEC §6): every page can `{% for x in
  // collections.<type> %}`. Uses the same `effectiveUrl` as page routing so listing
  // links match the pages they point at (homepage-at-root included).
  // Temporal context (SPEC §6): the build instant drives `now`/`today` in templates (used
  // by `where_exp` / the comparison filters). Read from the clock here at the impure CLI
  // edge — the generator core stays pure. CI's daily scheduled rebuild refreshes it so
  // time-relative content ("upcoming") stays correct without runtime logic.
  const clock = buildClock(new Date());
  const collections = assembleCollections(model, effectiveUrl);

  let pages = 0;
  let drafts = 0;
  let assets = 0;
  let redirects = 0;
  const sitemapUrls: string[] = [];

  // Site assets → <out>/assets/**. The active theme's own assets (`themes/<name>/assets/**`)
  // publish under `/assets` alongside the site's own uploads (`assets/**`), which override on
  // a path clash — so switching themes never disturbs a site's uploads (SPEC §13). In legacy
  // mode the single `assets/` root is the only source. SCSS is compiled (isomorphic dart-sass,
  // same as the browser preview, SPEC §6): a *main* stylesheet (a `.scss` carrying a `---`
  // front-matter fence, the Jekyll convention) becomes a sibling `.css`; partials (no fence,
  // e.g. under a theme's `_sass/`) are consumed via `@import` and not emitted; everything else
  // copies verbatim. `@import`/`@use` resolve against the theme's `_sass` + `assets/_sass` + the
  // file's own dir. Gathered lowest-priority first, keyed by OUTPUT path so a later (site-level)
  // source wins.
  const outputs = new Map<string, { repoPath: string; srcDir: string; rel: string }>();
  const scssFiles: Record<string, string> = {};
  for (const srcDir of assetSourceDirs(theme)) {
    for (const rel of await walkFiles(join(repoDir, srcDir))) {
      const repoPath = `${srcDir}/${rel}`;
      const outPath = assetOutputPath(repoPath, theme);
      if (outPath === null) continue;
      outputs.set(outPath, { repoPath, srcDir, rel });
      if (rel.endsWith('.scss')) {
        scssFiles[repoPath] = await readFile(join(repoDir, srcDir, rel), 'utf8');
      }
    }
  }
  const scssEngine = createEngine();
  const scssResolve = (scss: string): Promise<string> =>
    scssEngine.parseAndRender(scss, { site });
  for (const [outPath, { repoPath, srcDir, rel }] of outputs) {
    if (rel.endsWith('.scss')) {
      const source = scssFiles[repoPath]!;
      if (!/^---\r?\n/.test(source)) continue; // a partial — pulled in via @import, not emitted
      const css = await compileScss({
        source,
        entryPath: repoPath,
        files: scssFiles,
        loadPaths: theme.sassLoadPaths,
        resolve: scssResolve,
      });
      const outRel = outPath.replace(/\.scss$/, '.css').slice('assets/'.length);
      await mkdir(join(outDir, 'assets', dirname(outRel)), { recursive: true });
      await writeFile(join(outDir, 'assets', outRel), css, 'utf8');
    } else {
      const outRel = outPath.slice('assets/'.length);
      await copyFile(join(repoDir, srcDir, rel), join(outDir, 'assets', outRel));
    }
    assets += 1;
  }

  for (const object of model.objects) {
    const schema = schemas.get(object.type);
    if (!schema) continue; // unknown-type is already a model error above
    if (schema.page === false) continue; // config singleton, not a page
    if (!isPublic(object)) {
      drafts += 1;
      continue;
    }

    const template = resolveTemplate(object.type);
    const markdown = await readFile(join(repoDir, object.path), 'utf8');
    const url = effectiveUrl(object, schema);
    const seo = pageSeo(object, schema, site);
    if (homepageId && object.id === homepageId) {
      const baseUrl = typeof site.baseUrl === 'string' ? site.baseUrl : '';
      seo.canonical = baseUrl ? `${baseUrl}/` : '/';
    }

    // Multilingual (SPEC §5 → Multilingual): the sibling set drives `page.translations`
    // (language switcher) and the `hreflang` alternates in `<head>`. Both use `effectiveUrl`
    // so switcher links and pages agree. Empty for single-language sites → no-ops.
    const translations = translationsOf(model, object, effectiveUrl);
    const defaultLanguage =
      typeof site.defaultLanguage === 'string' ? site.defaultLanguage : undefined;
    const alternates = hreflangAlternates(translations, site, defaultLanguage);
    if (alternates.length > 0) seo.alternates = alternates;

    const renderInput: Parameters<typeof renderPage>[0] = {
      markdown,
      template,
      templates,
      site,
      collections,
      seo,
      now: clock.now,
      today: clock.today,
      // Register the Jekyll ecosystem filters/tags (SPEC §2 → Tier A). They're purely additive
      // (no built-in overrides), so a native Timber site is unaffected while an *adopted* Jekyll
      // theme — whose templates still call `{% seo %}`, `date_to_xmlschema`, etc. — builds with
      // plain `timber build`, no per-site config. The engine is cached per (templates, extend).
      extend: registerJekyllCompat,
    };
    if (object.lang !== undefined) renderInput.lang = object.lang;
    if (translations.length > 0) renderInput.translations = translations;
    const html = await renderPage(renderInput);

    const dir = urlToDir(url);
    await mkdir(join(outDir, dir), { recursive: true });
    await writeFile(join(outDir, dir, 'index.html'), html, 'utf8');
    pages += 1;
    sitemapUrls.push(seo.canonical);

    // Redirect stubs (SPEC §5): a renamed object keeps working URLs — each old slug
    // in `aliases` gets a meta-refresh page pointing at the object's current URL.
    for (const oldUrl of aliasUrls(object, schema)) {
      const stubDir = urlToDir(oldUrl);
      if (!stubDir) continue; // never overwrite the site root
      await mkdir(join(outDir, stubDir), { recursive: true });
      await writeFile(join(outDir, stubDir, 'index.html'), redirectStubHtml(url), 'utf8');
      redirects += 1;
    }

    // Colocated bundle assets: everything under the object's bundle dir except index.md.
    const bundleDir = dirname(object.path); // e.g. content/events/fete
    for (const rel of await walkFiles(join(repoDir, bundleDir))) {
      if (rel === 'index.md') continue;
      await copyFile(join(repoDir, bundleDir, rel), join(outDir, dir, rel));
      assets += 1;
    }
  }

  // SEO artifacts (SPEC §13): sitemap of every rendered page + robots pointing to it.
  await writeFile(join(outDir, 'sitemap.xml'), buildSitemap(sitemapUrls), 'utf8');
  await writeFile(join(outDir, 'robots.txt'), buildRobots(site), 'utf8');

  return { pages, drafts, assets, redirects };
}
