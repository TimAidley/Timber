import { unzipSync, strFromU8 } from 'fflate';
import {
  planThemeImport,
  setFrontMatterScalar,
  type PlanThemeOptions,
  type ThemeFiles,
  type ThemeImportPlan,
} from '@timber/jekyll-compat';
import type { FileWrite, HostProvider } from '@timber/host';

/**
 * Browser-side Jekyll theme import (SPEC §2 → Tier A) — the "do everything from a browser"
 * path. Unzips an uploaded theme, runs the shared, isomorphic {@link planThemeImport} into a
 * self-contained `themes/<name>/` folder, and commits the resulting templates + assets (SCSS
 * source included, compiled later by @timber/sass) to the site's WIP branch in one commit —
 * optionally flipping `settings.activeTheme` in the same commit so it goes live. No terminal.
 */

/** Files read as UTF-8 text; everything else (images, fonts) is kept as bytes. */
const TEXT_EXT =
  /\.(html|liquid|scss|sass|css|js|mjs|json|ya?ml|txt|md|markdown|svg|xml)$/i;

/** Normalize an archive/theme name to a safe folder slug (lowercase, dash-separated). */
export function slugifyThemeName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'theme';
}

/** Parse a theme archive: its {@link ThemeFiles} plus the wrapper dir name (a default theme name). */
function readZip(zip: Uint8Array): { files: ThemeFiles; rootName?: string } {
  const entries = unzipSync(zip);
  const paths = Object.keys(entries).filter((p) => !p.endsWith('/'));
  const roots = new Set(paths.map((p) => p.split('/')[0]!));
  const rootName = roots.size === 1 ? [...roots][0]! : undefined;
  const strip = rootName ? `${rootName}/` : '';
  const text: Record<string, string> = {};
  const binary: Record<string, Uint8Array> = {};
  for (const p of paths) {
    const rel = strip && p.startsWith(strip) ? p.slice(strip.length) : p;
    if (TEXT_EXT.test(rel)) text[rel] = strFromU8(entries[p]!);
    else binary[rel] = entries[p]!;
  }
  return rootName !== undefined ? { files: { text, binary }, rootName } : { files: { text, binary } };
}

/**
 * Unzip a Jekyll theme archive into {@link ThemeFiles}. A "Download ZIP" archive wraps
 * everything in a single top-level directory (e.g. `minima-3.0.0/`) — that wrapper is stripped
 * so paths are theme-root-relative. Directory entries are ignored; text vs binary is by extension.
 */
export function unzipTheme(zip: Uint8Array): ThemeFiles {
  return readZip(zip).files;
}

/** The default theme folder name for an archive: its wrapper dir slugified, else `theme`. */
export function defaultThemeNameFromZip(zip: Uint8Array): string {
  const { rootName } = readZip(zip);
  return rootName ? slugifyThemeName(rootName) : 'theme';
}

/** Flatten an import plan into the `FileWrite[]` a `commitFiles` call takes. */
export function planToFileWrites(plan: ThemeImportPlan): FileWrite[] {
  const files: FileWrite[] = [];
  for (const [path, content] of Object.entries(plan.templates))
    files.push({ path, content });
  for (const [path, content] of Object.entries(plan.textFiles))
    files.push({ path, content });
  for (const [path, bytes] of Object.entries(plan.binaryFiles))
    files.push({ path, bytes });
  return files;
}

/** The slice of the session an import needs: the host client + the branches to commit to. */
export interface ImportSession {
  client: Pick<HostProvider, 'commitFiles'>;
  wipBranch: string;
  defaultBranch: string;
}

export interface BrowserImportOptions extends PlanThemeOptions {
  /**
   * Activate the imported theme in the same commit: `path` is the settings singleton's
   * `index.md`, `source` its current content. The commit includes a copy with `activeTheme`
   * flipped to the new folder, so the theme goes live on publish without a second step. Any
   * previous theme stays on disk under its own `themes/<name>/`, so switching back is one edit.
   */
  activate?: { path: string; source: string };
}

/**
 * Import a Jekyll theme from a zip and commit it to the site's WIP branch in one commit.
 * Writes into `themes/<name>/` (name from `options.themeName`, else the archive's wrapper dir),
 * and — when `activate` is given — flips `settings.activeTheme` to it in the same commit.
 * Returns the plan (templates written, layouts chosen, type wiring) for the UI to report.
 */
export async function importThemeFromZip(
  session: ImportSession,
  zip: Uint8Array,
  options: BrowserImportOptions = {},
): Promise<ThemeImportPlan> {
  const { activate, ...planOptions } = options;
  const { files: themeFiles, rootName } = readZip(zip);
  const themeName =
    planOptions.themeName ?? (rootName ? slugifyThemeName(rootName) : 'theme');
  const plan = planThemeImport(themeFiles, { ...planOptions, themeName });
  const files = planToFileWrites(plan);
  if (activate) {
    files.push({
      path: activate.path,
      content: setFrontMatterScalar(activate.source, 'activeTheme', themeName),
    });
  }
  await session.client.commitFiles({
    branch: session.wipBranch,
    baseBranch: session.defaultBranch,
    message: `Import Jekyll theme "${themeName}" (${Object.keys(plan.templates).length} templates, ${files.length} files)`,
    files,
  });
  return plan;
}
