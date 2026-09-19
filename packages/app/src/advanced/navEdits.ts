import type { ContentModel, NavEntry } from '@timber/content';
import type { ReferenceOption } from '../forms/widgets.js';

/**
 * Pure list/row helpers behind the site menu editor (SPEC §13), kept out of the
 * component so the reordering and target-switching rules are unit-testable without
 * a DOM — the same split as `contentList.ts` and `advancedList.ts`.
 */

/**
 * A row's target kind, derived from the entry rather than held in component state
 * (which would have to be re-keyed on every reorder): an entry with a `url` links out
 * directly, anything else points at a page by id. A brand-new page row is
 * `{ label: '' }` with no target yet, which derives to "page" with nothing picked —
 * exactly what it is, and `validateNavigation` reports it until it's filled in.
 */
export function targetKind(entry: NavEntry): 'page' | 'url' {
  return entry.url !== undefined ? 'url' : 'page';
}

/**
 * Switch a row between linking to a page and linking to a URL, keeping the label and
 * dropping the other kind's target — an entry carrying both would be ambiguous, and
 * `loadNavigation` would silently prefer the url.
 */
export function withTargetKind(entry: NavEntry, kind: 'page' | 'url'): NavEntry {
  return kind === 'url' ? { label: entry.label, url: entry.url ?? '' } : { label: entry.label };
}

/** Set (or, with `undefined`, clear) a row's page target. */
export function withRef(entry: NavEntry, id: string | undefined): NavEntry {
  return id === undefined ? { label: entry.label } : { label: entry.label, ref: id };
}

/** Move an entry by `delta`, clamped: a move off either end is a no-op, not a wrap. */
export function moveEntry(entries: NavEntry[], index: number, delta: number): NavEntry[] {
  const to = index + delta;
  if (index < 0 || index >= entries.length || to < 0 || to >= entries.length) return entries;
  const next = [...entries];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved as NavEntry);
  return next;
}

/**
 * Every object that renders a page, as picker options — the settings singleton and any
 * other `page: false` type are not linkable, having no URL. Sorted by title, since the
 * author is looking for a name rather than a position.
 */
export function pageOptions(model: ContentModel): ReferenceOption[] {
  return model.objects
    .filter((o) => o.id && model.schemas.get(o.type)?.page !== false)
    .map((o) => ({ id: o.id as string, label: String(o.data.title ?? o.slug) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
