import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { renderPage } from '@timber/generator';
import {
  assembleContent,
  loadSchemas,
  loadNavigation,
  buildRobots,
  buildSitemap,
  canPublish,
  isPublic,
  pageSeo,
  siteContext,
  urlFor,
  Validator,
  type ContentObject,
  type ContentTypeSchema,
} from '@timber/content';
import { buildSnapshotFromDir } from './snapshot.node.js';

export interface BuildResult {
  pages: number;
  drafts: number;
  assets: number;
}

/** Thrown when the site can't be built — a broken site must never deploy (SPEC §12). */
export class BuildError extends Error {
  constructor(readonly problems: string[]) {
    super(`Build failed with ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
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
      const detail = result.errors.map((e) => `${e.field ? `${e.field}: ` : ''}${e.message}`).join('; ');
      problems.push(`invalid public object ${object.path}: ${detail}`);
    }
  }
  if (problems.length > 0) throw new BuildError(problems);

  const templateCache = new Map<string, string>();
  async function resolveTemplate(type: string): Promise<string> {
    if (templateCache.has(type)) return templateCache.get(type)!;
    for (const name of [`${type}.liquid`, 'default.liquid']) {
      const source = await readFile(join(repoDir, 'templates', name), 'utf8').catch(() => null);
      if (source !== null) {
        templateCache.set(type, source);
        return source;
      }
    }
    throw new BuildError([`no template for type "${type}" (templates/${type}.liquid or templates/default.liquid)`]);
  }

  // Site-wide context from the global-settings singleton (SPEC §13): the config
  // object whose type is marked `page: false`. It's read for `{{ site }}` but never
  // rendered as a page.
  const settingsObject = model.objects.find((o) => schemas.get(o.type)?.page === false);
  const site = siteContext(settingsObject);

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

  let pages = 0;
  let drafts = 0;
  let assets = 0;
  const sitemapUrls: string[] = [];

  // Site-wide assets: /assets/** → <out>/assets/**
  for (const rel of await walkFiles(join(repoDir, 'assets'))) {
    await copyFile(join(repoDir, 'assets', rel), join(outDir, 'assets', rel));
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

    const template = await resolveTemplate(object.type);
    const markdown = await readFile(join(repoDir, object.path), 'utf8');
    const url = effectiveUrl(object, schema);
    const seo = pageSeo(object, schema, site);
    if (homepageId && object.id === homepageId) {
      const baseUrl = typeof site.baseUrl === 'string' ? site.baseUrl : '';
      seo.canonical = baseUrl ? `${baseUrl}/` : '/';
    }
    const html = await renderPage({ markdown, template, site, seo });

    const dir = urlToDir(url);
    await mkdir(join(outDir, dir), { recursive: true });
    await writeFile(join(outDir, dir, 'index.html'), html, 'utf8');
    pages += 1;
    sitemapUrls.push(seo.canonical);

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

  return { pages, drafts, assets };
}
