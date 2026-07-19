import { unzipSync, strFromU8 } from 'fflate';
import {
  planThemeImport,
  type PlanThemeOptions,
  type ThemeFiles,
  type ThemeImportPlan,
} from '@timber/jekyll-compat';
import type { FileWrite, HostProvider } from '@timber/host';

/**
 * Browser-side Jekyll theme import (SPEC §2 → Tier A) — the "do everything from a browser"
 * path. Unzips an uploaded theme, runs the shared, isomorphic {@link planThemeImport}, and
 * commits the resulting `templates/*.liquid` + assets (SCSS source included, compiled later by
 * @timber/sass) to the site's WIP branch in one commit. No terminal, no CLI.
 */

/** Files read as UTF-8 text; everything else (images, fonts) is kept as bytes. */
const TEXT_EXT =
  /\.(html|liquid|scss|sass|css|js|mjs|json|ya?ml|txt|md|markdown|svg|xml)$/i;

/**
 * Unzip a Jekyll theme archive into {@link ThemeFiles}. A "Download ZIP" archive wraps
 * everything in a single top-level directory (e.g. `minima-3.0.0/`) — that wrapper is stripped
 * so paths are theme-root-relative. Directory entries are ignored; text vs binary is by extension.
 */
export function unzipTheme(zip: Uint8Array): ThemeFiles {
  const entries = unzipSync(zip);
  const paths = Object.keys(entries).filter((p) => !p.endsWith('/'));
  const roots = new Set(paths.map((p) => p.split('/')[0]!));
  const strip = roots.size === 1 ? `${[...roots][0]}/` : '';
  const text: Record<string, string> = {};
  const binary: Record<string, Uint8Array> = {};
  for (const p of paths) {
    const rel = strip && p.startsWith(strip) ? p.slice(strip.length) : p;
    if (TEXT_EXT.test(rel)) text[rel] = strFromU8(entries[p]!);
    else binary[rel] = entries[p]!;
  }
  return { text, binary };
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

/**
 * Import a Jekyll theme from a zip and commit it to the site's WIP branch in one commit.
 * Returns the plan (templates written, layouts chosen, type wiring) for the UI to report.
 */
export async function importThemeFromZip(
  session: ImportSession,
  zip: Uint8Array,
  options: PlanThemeOptions = {},
): Promise<ThemeImportPlan> {
  const plan = planThemeImport(unzipTheme(zip), options);
  const files = planToFileWrites(plan);
  await session.client.commitFiles({
    branch: session.wipBranch,
    baseBranch: session.defaultBranch,
    message: `Import Jekyll theme (${Object.keys(plan.templates).length} templates, ${files.length} files)`,
    files,
  });
  return plan;
}
