import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ContentModel, RepoSnapshot } from './types.js';

/** One top-level navigation link (SPEC §13: editorial, not structural). */
export interface NavItem {
  label: string;
  url: string;
}

/**
 * One navigation entry **as authored** — before refs are resolved to URLs. The
 * authored form is what the nav editor round-trips and what {@link validateNavigation}
 * checks; {@link NavItem} is the resolved form templates see.
 */
export interface NavEntry {
  /** `''` when the entry has no usable label — a problem to report, not to drop silently. */
  label: string;
  /** An explicit URL (external links, or anything not backed by an object). */
  url?: string;
  /** An object id, resolved to its URL at build time. */
  ref?: string;
}

/** A problem with an authored nav entry. Advisory (SPEC §13): never blocks a build. */
export interface NavProblem {
  /** Index into the authored entry list, so a UI can point at the offending row. */
  index: number;
  kind: 'dangling-ref' | 'no-target' | 'no-label';
  message: string;
}

/** Both spellings are read; `NAV_PATH` is the one we write. */
export const NAV_PATHS = ['config/navigation.yml', 'config/navigation.yaml'] as const;
export const NAV_PATH = NAV_PATHS[0];

/** The nav file's path and raw text in this snapshot, or undefined when there is none. */
export function navigationSource(
  snapshot: RepoSnapshot,
): { path: string; raw: string } | undefined {
  for (const path of NAV_PATHS) {
    const raw = snapshot.get(path);
    if (raw !== undefined) return { path, raw };
  }
  return undefined;
}

function asList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)) {
    return (parsed as { items: unknown[] }).items;
  }
  return [];
}

/**
 * Parse the nav file into authored entries — **total, not filtering**: an entry with a
 * missing label or no target still comes back (with `label: ''` and/or neither `url` nor
 * `ref`) so the editor can show it and {@link validateNavigation} can report it. Only
 * list items that aren't objects at all are dropped, there being nothing to preserve.
 * Malformed YAML yields `[]` rather than throwing: a broken menu must not break a build.
 */
export function parseNavigation(raw: string): NavEntry[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return [];
  }

  const entries: NavEntry[] = [];
  for (const item of asList(parsed)) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const entry: NavEntry = { label: typeof e.label === 'string' ? e.label : '' };
    if (typeof e.url === 'string') entry.url = e.url;
    else if (typeof e.ref === 'string') entry.ref = e.ref;
    entries.push(entry);
  }
  return entries;
}

/**
 * Render authored entries back to YAML, for the nav editor's writes. Canonical output
 * (the `items:` wrapper and any comments in a hand-authored file are not preserved) —
 * the same trade `timber fmt` makes for content: one spelling, so a file doesn't show
 * up as modified just for having been opened.
 */
export function serializeNavigation(entries: NavEntry[]): string {
  if (entries.length === 0) return '[]\n';
  return stringifyYaml(
    entries.map((e) => {
      const out: Record<string, string> = { label: e.label };
      if (e.url !== undefined) out.url = e.url;
      else if (e.ref !== undefined) out.ref = e.ref;
      return out;
    }),
  );
}

/**
 * Load the site's manual navigation from `config/navigation.yml` (SPEC §13). Each
 * entry is `{ label, url }` (an explicit URL) or `{ label, ref }` (an object id,
 * resolved to its URL via the injected `resolveRef` — the build passes one that
 * knows about homepage-at-root). Dangling refs are skipped rather than breaking the
 * build; {@link validateNavigation} is what surfaces them to the author. Returns `[]`
 * when there's no nav config.
 */
export function loadNavigation(
  snapshot: RepoSnapshot,
  resolveRef: (id: string) => string | undefined,
): NavItem[] {
  const source = navigationSource(snapshot);
  if (source === undefined) return [];

  const items: NavItem[] = [];
  for (const entry of parseNavigation(source.raw)) {
    if (!entry.label) continue;
    if (entry.url !== undefined) {
      items.push({ label: entry.label, url: entry.url });
    } else if (entry.ref !== undefined) {
      const url = resolveRef(entry.ref);
      if (url) items.push({ label: entry.label, url });
    }
  }
  return items;
}

/**
 * Report nav entries that won't render: a `ref` to an id no longer in the model (the
 * usual cause being a deleted object), an entry with no target at all, or one with no
 * label. **Advisory** (SPEC §13): a broken menu item is a missing link, not a broken
 * site, so this never fails a build or blocks a publish — it's what the nav editor and
 * `timber validate` show so the author finds out before a visitor does.
 */
export function validateNavigation(entries: NavEntry[], model: ContentModel): NavProblem[] {
  const problems: NavProblem[] = [];
  entries.forEach((entry, index) => {
    if (entry.ref !== undefined && !model.byId.has(entry.ref)) {
      problems.push({
        index,
        kind: 'dangling-ref',
        message: `"${entry.label || '(untitled)'}" points at a missing object (${entry.ref})`,
      });
    } else if (entry.url === undefined && entry.ref === undefined) {
      problems.push({
        index,
        kind: 'no-target',
        message: `"${entry.label || '(untitled)'}" has no page or URL to link to`,
      });
    }
    if (!entry.label) {
      problems.push({ index, kind: 'no-label', message: `Entry ${index + 1} has no label` });
    }
  });
  return problems;
}

/**
 * The nav entries pointing at `id` — the menu's counterpart to `referrersTo`, which
 * only sweeps schema `reference` fields and so can't see the navigation file. Powers
 * the guarded-delete warning (SPEC §5), so deleting a page that's in the site menu is
 * a deliberate choice rather than an item that quietly vanishes from the header.
 */
export function navigationReferrers(entries: NavEntry[], id: string): NavEntry[] {
  return entries.filter((entry) => entry.ref === id);
}
