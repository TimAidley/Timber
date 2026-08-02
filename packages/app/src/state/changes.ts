/**
 * A content object's place on the change lifecycle (SPEC §8/§11), for the sidebar
 * badges and the header summary. Deliberately excludes the later `submitted`/
 * `published` stages: those are transient, site-wide states shown by the Publish
 * button, not per-item — once an object's change reaches `main` it's simply clean.
 *
 *   editing  → local-only edits on this device, not yet on your `<login>_wip` branch
 *   saved    → committed to your WIP branch, not yet published to `main`
 *   deleting → marked for removal (a pending deletion), restorable until published
 *   clean    → matches the published site source (nothing pending)
 */
export type ChangeState = 'editing' | 'saved' | 'deleting' | 'clean';

/**
 * Classify one object by its `index.md` path against the live change sets. A pending
 * deletion wins (the object is on its way out, whatever else it had). Otherwise
 * `editing` (uncommitted, the furthest-back state) wins over `saved`. An object counts
 * as `saved` when its `index.md` **or any colocated asset** under its bundle differs
 * from `main`, so an image-only change still surfaces.
 */
export function objectChangeState(
  path: string,
  editing: ReadonlySet<string>,
  saved: ReadonlySet<string>,
  deleting?: ReadonlySet<string>,
): ChangeState {
  if (deleting?.has(path)) return 'deleting';
  if (editing.has(path)) return 'editing';
  if (saved.has(path)) return 'saved';
  const bundleDir = path.replace(/\/index\.md$/, '') + '/';
  for (const p of saved) if (p.startsWith(bundleDir)) return 'saved';
  return 'clean';
}

/**
 * Tally the header counts ("Editing 1 · Saved 4") from the live change sets.
 *
 * Counts **objects and site files alike**. Not everything pending publish is a content
 * object: a template, schema, config file or theme asset edited in the advanced area is
 * committed to the same WIP branch and ships in the same publish, but belongs to no
 * object. Tallying objects alone left an advanced-area-only change invisible — the header
 * read "No unpublished changes" and, because the Publish button is gated on these counts,
 * the change could not be published at all without touching an unrelated object first.
 *
 * A site file is any changed path that is neither an object's `index.md` nor inside an
 * object's bundle — a colocated asset already counts towards its own object (see
 * {@link objectChangeState}) and must not be counted twice.
 *
 * Site files run the same two-stage lifecycle as objects: `editing` while the edit is
 * only in this browser, `saved` once it's on the WIP branch — and `editing` wins, since
 * it's the furthest-back state. Counting them as `saved` only (their branch state) meant
 * a template or stylesheet edited in the advanced area showed *nothing* in the header
 * until the coalesced commit landed seconds later, unlike a page edit, which badges
 * immediately.
 */
export function summarizeChanges(
  objectPaths: readonly string[],
  editing: ReadonlySet<string>,
  saved: ReadonlySet<string>,
  deleting?: ReadonlySet<string>,
): { editing: number; saved: number; deleting: number } {
  let e = 0;
  let s = 0;
  let d = 0;
  for (const path of objectPaths) {
    const state = objectChangeState(path, editing, saved, deleting);
    if (state === 'editing') e += 1;
    else if (state === 'saved') s += 1;
    else if (state === 'deleting') d += 1;
  }
  for (const { state } of siteFileChanges(objectPaths, editing, saved)) {
    if (state === 'editing') e += 1;
    else s += 1;
  }
  return { editing: e, saved: s, deleting: d };
}

/**
 * The changed paths that belong to no content object — templates, styles, schemas,
 * config and stray site assets — each with its lifecycle state. An object's own
 * `index.md` and anything inside its bundle are excluded: those belong to the object
 * (see {@link objectChangeState}) and would otherwise be counted twice.
 *
 * Shared by the header counts and the changes panel so the two can't disagree about
 * what's pending.
 */
export function siteFileChanges(
  objectPaths: readonly string[],
  editing: ReadonlySet<string>,
  saved: ReadonlySet<string>,
): { path: string; state: 'editing' | 'saved' }[] {
  const owned = new Set(objectPaths);
  const bundles = objectPaths.map((p) => p.replace(/\/index\.md$/, '') + '/');
  const isSiteFile = (path: string): boolean =>
    !owned.has(path) && !bundles.some((prefix) => path.startsWith(prefix));
  const out: { path: string; state: 'editing' | 'saved' }[] = [];
  const seen = new Set<string>();
  for (const path of [...editing, ...saved]) {
    if (seen.has(path) || !isSiteFile(path)) continue;
    seen.add(path);
    out.push({ path, state: editing.has(path) ? 'editing' : 'saved' });
  }
  return out;
}
