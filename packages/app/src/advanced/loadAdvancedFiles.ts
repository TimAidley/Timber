import type { HostProvider } from '@timber/host';
import { LEGACY_THEME, type ThemePaths } from '@timber/content';

/**
 * A source file the advanced area edits: a Liquid template or a config YAML. These
 * live *outside* the content snapshot (`loadSnapshot` only carries assembled content
 * objects, and `templates/` isn't in its filter at all), so the advanced area loads
 * their raw text itself.
 */
export interface AdvancedFile {
  path: string;
  kind: AdvancedKind;
  content: string;
}

/** Which validator + editor language a file gets. */
export type AdvancedKind = 'template' | 'style' | 'schema' | 'config';

const CONFIG_RE = /^config\/.*\.ya?ml$/;

/** Classify a repo path into the kind that drives validation + syntax highlighting, scoped to
 *  the active theme (SPEC §13): a `template`/`style` is one under *this* theme's
 *  `templatesDir`/`assetsDir` (so the advanced area only ever surfaces the current theme's
 *  files, never a sibling theme's). `config/**` is site-level, theme-independent. `assetsDir`
 *  `.css` files are editable text, unlike the fonts/images that also live there (those need
 *  the binary manager). Defaults to the legacy root for callers without a resolved theme. */
export function kindOf(path: string, theme: ThemePaths = LEGACY_THEME): AdvancedKind | undefined {
  if (path.startsWith(`${theme.templatesDir}/`) && path.endsWith('.liquid')) return 'template';
  if (path.startsWith(`${theme.assetsDir}/`) && path.endsWith('.css')) return 'style';
  if (CONFIG_RE.test(path)) return path.startsWith('config/schemas/') ? 'schema' : 'config';
  return undefined;
}

/**
 * Load every editable template + config file from a branch into memory (SPEC §8:
 * the advanced area is the same edit-preview-commit loop pointed at these files).
 * Uses `loadTree` + `readBlob` — the same primitives `loadSnapshot` is built on —
 * fetching each blob concurrently. Sorted templates → schemas → config for a stable
 * file list.
 */
export async function loadAdvancedFiles(
  client: HostProvider,
  ref: string,
  theme: ThemePaths = LEGACY_THEME,
): Promise<AdvancedFile[]> {
  const tree = await client.loadTree(ref);
  const targets = tree.entries.flatMap((entry) => {
    if (entry.type !== 'blob') return [];
    const kind = kindOf(entry.path, theme);
    return kind ? [{ path: entry.path, sha: entry.sha, kind }] : [];
  });

  const files = await Promise.all(
    targets.map(async ({ path, sha, kind }): Promise<AdvancedFile> => ({
      path,
      kind,
      content: await client.readBlob(sha),
    })),
  );

  const order: Record<AdvancedKind, number> = { template: 0, style: 1, schema: 2, config: 3 };
  return files.sort((a, b) => order[a.kind] - order[b.kind] || a.path.localeCompare(b.path));
}
