import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { createEngine } from '@timber/generator';
import { importJekyllTheme } from '@timber/jekyll-compat';
import { compileThemeStylesheet } from './sass.node.js';

/**
 * **Adopt-once** import of a Jekyll theme into a Timber content repo (SPEC §2 → Tier A). A
 * Jekyll theme is transformed **once** into native Timber `templates/*.liquid` + compiled
 * `assets/…`, committed to the repo — after which the site is an ordinary Timber site with no
 * runtime Jekyll dependency. Re-run against an upstream theme update to re-adopt.
 *
 * The transform is light and localized (layout chaining, include syntax, `include.*`, escape
 * reconciliation — see `@timber/jekyll-compat`), so the written templates read as the original
 * theme lightly adapted, not machine-mangled output.
 */

export interface ImportThemeOptions {
  /** The base layout others chain to. Auto-detected (prefers `base`, then `default`) if unset. */
  rootLayout?: string;
  /** Which layout becomes `templates/default.liquid` (Timber's per-type fallback). Auto if unset. */
  defaultLayout?: string;
  /**
   * Per-content-type layout wiring: `{ <type>: <layout> }`. For each entry, the Jekyll
   * `<layout>` is written as `templates/<type>.liquid`, so Timber renders that content type
   * through that layout (e.g. `{ posts: 'post' }` → a `posts` type uses the theme's `post`
   * layout). Types not listed fall back to `templates/default.liquid`.
   */
  typeMap?: Record<string, string>;
}

export interface ImportThemeResult {
  /** Repo-relative template paths written. */
  templates: string[];
  /** Repo-relative asset paths copied verbatim. */
  assets: string[];
  /** Repo-relative CSS paths compiled from SCSS. */
  compiled: string[];
  rootLayout: string;
  defaultLayout: string;
  /** The `type → layout` wiring applied (from `typeMap`). */
  mapped: Record<string, string>;
}

/**
 * Parse `--map <type>=<layout>` occurrences (repeatable, and comma-separated values allowed)
 * from an arg list into `{ type: layout }`, returning the map + the remaining positionals.
 * Lives here (not in the bin entry) so it's unit-testable — the CLI index runs on import.
 */
export function parseImportArgs(args: string[]): {
  positionals: string[];
  typeMap: Record<string, string>;
} {
  const positionals: string[] = [];
  const typeMap: Record<string, string> = {};
  const addPair = (pair: string): void => {
    const [type, layout] = pair.split('=');
    if (type && layout) typeMap[type.trim()] = layout.trim();
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--map') args[++i]?.split(',').forEach(addPair);
    else if (arg.startsWith('--map='))
      arg.slice('--map='.length).split(',').forEach(addPair);
    else positionals.push(arg);
  }
  return { positionals, typeMap };
}

/** All `*.html` in `<themeDir>/<sub>` as bare-name → source; `{}` if the dir is absent. */
async function readHtmlDir(
  themeDir: string,
  sub: string,
): Promise<Record<string, string>> {
  const dir = join(themeDir, sub);
  const entries = await readdir(dir).catch(() => null);
  if (!entries) return {};
  const out: Record<string, string> = {};
  for (const file of entries) {
    if (file.endsWith('.html'))
      out[file.replace(/\.html$/, '')] = await readFile(join(dir, file), 'utf8');
  }
  return out;
}

/** True if a template's front matter declares a `layout:` (i.e. it chains to a parent). */
function chainsToParent(source: string): boolean {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  return fm ? /^layout:\s*\S/m.test(fm[1]!) : false;
}

/** All files (recursive, posix-relative) under `absDir`; [] if absent. */
async function walk(absDir: string, base = absDir): Promise<string[]> {
  const entries = await readdir(absDir, { withFileTypes: true }).catch(() => null);
  if (!entries) return [];
  const out: string[] = [];
  for (const entry of entries) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs, base)));
    else out.push(relative(base, abs).split(sep).join('/'));
  }
  return out;
}

/**
 * Import the theme at `themeDir` into the Timber repo at `repoDir`. Writes
 * `templates/<name>.liquid` for every layout + include, ensures a `templates/default.liquid`
 * fallback, compiles any front-matter SCSS under `assets/` (dart-sass, resolving the skin
 * `@import` via the generator engine) to a sibling `.css`, and copies the rest of `assets/`
 * verbatim. Returns a manifest of what it wrote.
 */
export async function importThemeToRepo(
  themeDir: string,
  repoDir: string,
  options: ImportThemeOptions = {},
): Promise<ImportThemeResult> {
  const layouts = await readHtmlDir(themeDir, '_layouts');
  const includes = await readHtmlDir(themeDir, '_includes');
  if (Object.keys(layouts).length === 0) {
    throw new Error(`no _layouts found in ${themeDir} — is this a Jekyll theme?`);
  }

  // Root layout: the one others chain to (no `layout:` of its own), preferring base|default.
  const roots = Object.keys(layouts).filter((n) => !chainsToParent(layouts[n]!));
  const rootLayout =
    options.rootLayout ??
    (roots.includes('base') ? 'base' : roots.includes('default') ? 'default' : roots[0]);
  if (!rootLayout)
    throw new Error('could not determine a root layout (all layouts chain to a parent?)');

  const { templates } = importJekyllTheme({ ...layouts, ...includes }, rootLayout);

  // Default fallback layout (templates/default.liquid): explicit → a `default` layout → `page`
  // → the root. Every content type with no `templates/<type>.liquid` renders through this.
  const layoutNames = Object.keys(layouts);
  const defaultLayout =
    options.defaultLayout ??
    (layoutNames.includes('default')
      ? 'default'
      : layoutNames.includes('page')
        ? 'page'
        : rootLayout);

  // Write templates.
  const written: string[] = [];
  async function writeTemplate(name: string, source: string): Promise<void> {
    const rel = `templates/${name}.liquid`;
    await mkdir(dirname(join(repoDir, rel)), { recursive: true });
    await writeFile(join(repoDir, rel), source, 'utf8');
    written.push(rel);
  }
  for (const [name, source] of Object.entries(templates))
    await writeTemplate(name, source);
  if (!templates['default']) await writeTemplate('default', templates[defaultLayout]!);

  // Per-type wiring (`--map <type>=<layout>`): write templates/<type>.liquid so Timber renders
  // that content type through the named layout instead of the default fallback.
  const mapped: Record<string, string> = {};
  for (const [type, layout] of Object.entries(options.typeMap ?? {})) {
    const source = templates[layout];
    if (source === undefined) {
      throw new Error(
        `--map ${type}=${layout}: no layout "${layout}" in the theme (have: ${layoutNames.join(', ')})`,
      );
    }
    await writeTemplate(type, source);
    mapped[type] = layout;
  }

  // Assets: compile front-matter SCSS (resolve the skin @import via the engine → the theme's
  // `default:` skin), copy everything else verbatim.
  const engine = createEngine();
  const resolve = (scss: string): Promise<string> =>
    engine.parseAndRender(scss, { site: {} });
  const sassLoadPath = join(themeDir, '_sass');
  const assets: string[] = [];
  const compiled: string[] = [];
  for (const rel of await walk(join(themeDir, 'assets'))) {
    const from = join(themeDir, 'assets', rel);
    // A Jekyll main stylesheet is `.scss` carrying a `---` front-matter fence; only those are
    // Liquid-processed + compiled. Partial `.scss` (no fence) are pulled in via @import, and
    // everything else (committed CSS, JS, images) copies verbatim.
    const isMainScss =
      rel.endsWith('.scss') && /^---\r?\n/.test(await readFile(from, 'utf8'));
    if (isMainScss) {
      const css = await compileThemeStylesheet({
        source: await readFile(from, 'utf8'),
        loadPaths: [sassLoadPath],
        resolve,
      });
      const outRel = `assets/${rel.replace(/\.scss$/, '.css')}`;
      await mkdir(dirname(join(repoDir, outRel)), { recursive: true });
      await writeFile(join(repoDir, outRel), css, 'utf8');
      compiled.push(outRel);
    } else if (!rel.endsWith('.scss')) {
      // Skip partial .scss (consumed by @import); copy other assets verbatim.
      const outRel = `assets/${rel}`;
      await mkdir(dirname(join(repoDir, outRel)), { recursive: true });
      await writeFile(join(repoDir, outRel), await readFile(from), 'utf8');
      assets.push(outRel);
    }
  }

  return { templates: written, assets, compiled, rootLayout, defaultLayout, mapped };
}
