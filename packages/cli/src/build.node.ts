import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { renderPage } from '@timber/generator';
import {
  assembleContent,
  loadSchemas,
  canPublish,
  isPublic,
  urlFor,
  Validator,
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

  let pages = 0;
  let drafts = 0;
  let assets = 0;

  // Site-wide assets: /assets/** → <out>/assets/**
  for (const rel of await walkFiles(join(repoDir, 'assets'))) {
    await copyFile(join(repoDir, 'assets', rel), join(outDir, 'assets', rel));
    assets += 1;
  }

  for (const object of model.objects) {
    if (!isPublic(object)) {
      drafts += 1;
      continue;
    }
    const schema = schemas.get(object.type);
    if (!schema) continue; // unknown-type is already a model error above
    const template = await resolveTemplate(object.type);
    const markdown = await readFile(join(repoDir, object.path), 'utf8');
    const html = await renderPage({ markdown, template, site: {} });

    const dir = urlToDir(urlFor(object, schema));
    await mkdir(join(outDir, dir), { recursive: true });
    await writeFile(join(outDir, dir, 'index.html'), html, 'utf8');
    pages += 1;

    // Colocated bundle assets: everything under the object's bundle dir except index.md.
    const bundleDir = dirname(object.path); // e.g. content/events/fete
    for (const rel of await walkFiles(join(repoDir, bundleDir))) {
      if (rel === 'index.md') continue;
      await copyFile(join(repoDir, bundleDir, rel), join(outDir, dir, rel));
      assets += 1;
    }
  }

  return { pages, drafts, assets };
}
