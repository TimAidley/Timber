import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, relative, sep, basename } from 'node:path';
import {
  planThemeImport,
  setFrontMatterScalar,
  type PlanThemeOptions,
  type ThemeFiles,
} from '@timber/jekyll-compat';
import { loadSchemas, type RepoSnapshot } from '@timber/content';
import { buildSnapshotFromDir } from './snapshot.node.js';

/**
 * **Adopt-once** import of a Jekyll theme into a Timber content repo (SPEC §2 → Tier A). A
 * Jekyll theme is transformed **once** into native Timber `templates/*.liquid` + its assets
 * (incl. SCSS source), written to the repo — after which the site is an ordinary Timber site.
 * Re-run against an upstream theme update to re-adopt.
 *
 * The theme→repo mapping is the pure, isomorphic {@link planThemeImport} (shared with the
 * browser import path); this module only reads the theme off disk and writes the plan out.
 */

export type ImportThemeOptions = PlanThemeOptions;

export interface ImportThemeResult {
  /** Repo-relative template paths written. */
  templates: string[];
  /** Repo-relative asset paths written (incl. SCSS source + `_sass/` → `assets/_sass/`). */
  assets: string[];
  rootLayout: string;
  defaultLayout: string;
  /** The `type → layout` wiring applied (from `typeMap`). */
  mapped: Record<string, string>;
  /** The theme folder written to (`themes/<name>/`), or `null` for the legacy root. */
  themeName: string | null;
}

/**
 * Point the site's settings singleton at `themeName` (its `activeTheme`), so the imported theme
 * goes live. Finds the singleton the same way the build does — the type marked `page: false` —
 * and patches its `index.md`. Returns the patched path, or `null` if there's no settings
 * singleton to update (the caller then tells the user to set `activeTheme` by hand).
 */
export async function activateTheme(
  repoDir: string,
  themeName: string,
): Promise<string | null> {
  const snapshot: RepoSnapshot = await buildSnapshotFromDir(repoDir);
  const schemas = loadSchemas(snapshot);
  const configTypes = new Set(
    [...schemas.entries()].filter(([, s]) => s.page === false).map(([type]) => type),
  );
  let settingsPath: string | undefined;
  for (const path of snapshot.keys()) {
    const m = /^content\/([^/]+)\/index\.md$/.exec(path);
    if (m && configTypes.has(m[1]!)) {
      settingsPath = path;
      break;
    }
  }
  if (!settingsPath) return null;
  const source = await readFile(join(repoDir, settingsPath), 'utf8');
  await writeFile(join(repoDir, settingsPath), setFrontMatterScalar(source, 'activeTheme', themeName));
  return settingsPath;
}

/**
 * Parse `--map <type>=<layout>` occurrences (repeatable, and comma-separated values allowed)
 * from an arg list into `{ type: layout }`, returning the map + the remaining positionals.
 * Lives here (not in the bin entry) so it's unit-testable — the CLI index runs on import.
 */
export function parseImportArgs(args: string[]): {
  positionals: string[];
  typeMap: Record<string, string>;
  name?: string;
} {
  const positionals: string[] = [];
  const typeMap: Record<string, string> = {};
  let name: string | undefined;
  const addPair = (pair: string): void => {
    const [type, layout] = pair.split('=');
    if (type && layout) typeMap[type.trim()] = layout.trim();
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--map') args[++i]?.split(',').forEach(addPair);
    else if (arg.startsWith('--map='))
      arg.slice('--map='.length).split(',').forEach(addPair);
    else if (arg === '--name') name = args[++i]?.trim() || undefined;
    else if (arg.startsWith('--name=')) name = arg.slice('--name='.length).trim() || undefined;
    else positionals.push(arg);
  }
  return name !== undefined ? { positionals, typeMap, name } : { positionals, typeMap };
}

/** Derive a default theme folder name from a theme directory path (its basename, slugified). */
export function defaultThemeName(themeDir: string): string {
  const base = basename(themeDir.replace(/[/\\]+$/, ''));
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'theme';
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

/** Files that are text (read as UTF-8); everything else (images, fonts) is read as bytes. */
const TEXT_EXT =
  /\.(html|liquid|scss|sass|css|js|mjs|json|ya?ml|txt|md|markdown|svg|xml)$/i;

/** Read the theme's `_layouts`/`_includes`/`assets`/`_sass` into an in-memory {@link ThemeFiles}. */
async function readThemeFiles(themeDir: string): Promise<ThemeFiles> {
  const text: Record<string, string> = {};
  const binary: Record<string, Uint8Array> = {};
  for (const sub of ['_layouts', '_includes', 'assets', '_sass']) {
    for (const rel of await walk(join(themeDir, sub))) {
      const themePath = `${sub}/${rel}`;
      const abs = join(themeDir, sub, rel);
      if (TEXT_EXT.test(rel)) text[themePath] = await readFile(abs, 'utf8');
      else binary[themePath] = new Uint8Array(await readFile(abs));
    }
  }
  return { text, binary };
}

/**
 * Import the theme at `themeDir` into the Timber repo at `repoDir`: read it into memory, run
 * the shared {@link planThemeImport}, and write the resulting `templates/*.liquid` + assets.
 * SCSS is NOT compiled here — the build and the browser preview compile it isomorphically
 * (@timber/sass), so the repo carries the SCSS source and stays editable.
 */
export async function importThemeToRepo(
  themeDir: string,
  repoDir: string,
  options: ImportThemeOptions = {},
): Promise<ImportThemeResult> {
  const plan = planThemeImport(await readThemeFiles(themeDir), options);

  async function write(repoPath: string, data: string | Uint8Array): Promise<void> {
    await mkdir(dirname(join(repoDir, repoPath)), { recursive: true });
    await writeFile(join(repoDir, repoPath), data);
  }

  const templates: string[] = [];
  for (const [path, source] of Object.entries(plan.templates)) {
    await write(path, source);
    templates.push(path);
  }
  const assets: string[] = [];
  for (const [path, source] of Object.entries(plan.textFiles)) {
    await write(path, source);
    assets.push(path);
  }
  for (const [path, bytes] of Object.entries(plan.binaryFiles)) {
    await write(path, bytes);
    assets.push(path);
  }

  return {
    templates,
    assets,
    rootLayout: plan.rootLayout,
    defaultLayout: plan.defaultLayout,
    mapped: plan.mapped,
    themeName: plan.themeName,
  };
}
