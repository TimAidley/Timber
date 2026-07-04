import type { RepoClient } from '@timber/github';

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
export type AdvancedKind = 'template' | 'schema' | 'config';

const TEMPLATE_RE = /^templates\/.*\.liquid$/;
const CONFIG_RE = /^config\/.*\.ya?ml$/;

/** Classify a repo path into the kind that drives validation + syntax highlighting. */
export function kindOf(path: string): AdvancedKind | undefined {
  if (TEMPLATE_RE.test(path)) return 'template';
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
export async function loadAdvancedFiles(client: RepoClient, ref: string): Promise<AdvancedFile[]> {
  const tree = await client.loadTree(ref);
  const targets = tree.entries.flatMap((entry) => {
    if (entry.type !== 'blob') return [];
    const kind = kindOf(entry.path);
    return kind ? [{ path: entry.path, sha: entry.sha, kind }] : [];
  });

  const files = await Promise.all(
    targets.map(async ({ path, sha, kind }): Promise<AdvancedFile> => ({
      path,
      kind,
      content: await client.readBlob(sha),
    })),
  );

  const order: Record<AdvancedKind, number> = { template: 0, schema: 1, config: 2 };
  return files.sort((a, b) => order[a.kind] - order[b.kind] || a.path.localeCompare(b.path));
}
