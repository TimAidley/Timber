/**
 * Which content-type groups the author has collapsed in the sidebar navigator (SPEC §5).
 *
 * Like the layout toggles (`state/layout.ts`) this is a per-device *UI preference*, not
 * content or a secret, so `localStorage` is its right home — the SPEC's "keep it out of
 * `localStorage`" rule is about tokens. Storage is best-effort: private mode or a
 * corrupted value just means the sidebar opens with every group expanded.
 */
const LS_KEY = 'timber:contentList:collapsed';

/** Read the collapsed type names. A missing or malformed value reads as "none collapsed". */
export function readCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((t): t is string => typeof t === 'string'));
  } catch {
    return new Set();
  }
}

/** Persist the collapsed type names (sorted, so the stored value is stable). */
export function writeCollapsedGroups(types: ReadonlySet<string>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...types].sort()));
  } catch {
    /* private mode / storage disabled — collapse state just won't survive a reload */
  }
}

/** Toggle one type's collapsed state, returning a new set (never mutates the input). */
export function toggleCollapsedGroup(
  collapsed: ReadonlySet<string>,
  type: string,
): Set<string> {
  const next = new Set(collapsed);
  if (!next.delete(type)) next.add(type);
  return next;
}
