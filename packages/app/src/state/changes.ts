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

/** Tally per-object change states into the header counts ("Editing 1 · Saved 4"). */
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
  return { editing: e, saved: s, deleting: d };
}
