import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import {
  planThemeImport,
  type PlanThemeOptions,
  type ThemeFiles,
} from '@timber/jekyll-compat';

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
  };
}
