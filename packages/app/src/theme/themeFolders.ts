import { THEMES_DIR } from '@timber/content';
import type { TreeEntry } from '@timber/host';

/**
 * Discovery + delete helpers for the theme folders under `themes/` (SPEC §13). Pure tree
 * inspection so the theme manager (switch / delete) is unit-testable away from React and the
 * host client.
 */

/**
 * The names of the renderable themes in a repo tree — each distinct `<name>` under `themes/`
 * that carries at least one `themes/<name>/templates/*.liquid` (so a half-deleted or assets-only
 * folder isn't offered as something to switch *to*). Sorted for a stable list.
 */
export function listThemes(entries: readonly TreeEntry[]): string[] {
  const names = new Set<string>();
  const re = new RegExp(`^${THEMES_DIR}/([^/]+)/templates/.+\\.liquid$`);
  for (const e of entries) {
    if (e.type !== 'blob') continue;
    const m = re.exec(e.path);
    if (m) names.add(m[1]!);
  }
  return [...names].sort();
}

/** Every repo path under `themes/<name>/` — the delete set for removing a theme wholesale. */
export function themeFolderPaths(entries: readonly TreeEntry[], name: string): string[] {
  const prefix = `${THEMES_DIR}/${name}/`;
  return entries
    .filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
    .map((e) => e.path);
}
