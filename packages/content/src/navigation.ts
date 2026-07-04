import { parse as parseYaml } from 'yaml';
import type { RepoSnapshot } from './types.js';

/** One top-level navigation link (SPEC §13: editorial, not structural). */
export interface NavItem {
  label: string;
  url: string;
}

const NAV_PATHS = ['config/navigation.yml', 'config/navigation.yaml'];

function asList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)) {
    return (parsed as { items: unknown[] }).items;
  }
  return [];
}

/**
 * Load the site's manual navigation from `config/navigation.yml` (SPEC §13). Each
 * entry is `{ label, url }` (an explicit URL) or `{ label, ref }` (an object id,
 * resolved to its URL via the injected `resolveRef` — the build passes one that
 * knows about homepage-at-root). Dangling refs are skipped rather than breaking the
 * build. Returns `[]` when there's no nav config.
 */
export function loadNavigation(
  snapshot: RepoSnapshot,
  resolveRef: (id: string) => string | undefined,
): NavItem[] {
  const raw = NAV_PATHS.map((p) => snapshot.get(p)).find((v) => v !== undefined);
  if (raw === undefined) return [];

  const items: NavItem[] = [];
  for (const entry of asList(parseYaml(raw))) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const label = typeof e.label === 'string' ? e.label : undefined;
    if (!label) continue;

    if (typeof e.url === 'string') {
      items.push({ label, url: e.url });
    } else if (typeof e.ref === 'string') {
      const url = resolveRef(e.ref);
      if (url) items.push({ label, url });
    }
  }
  return items;
}
