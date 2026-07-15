import { kindOf, type AdvancedFile, type AdvancedKind } from './loadAdvancedFiles.js';
import { validateAdvancedFile } from './validate.js';

/** Sort key for the advanced file list: templates → styles → schemas → config, by path. */
export const KIND_ORDER: Record<AdvancedKind, number> = {
  template: 0,
  style: 1,
  schema: 2,
  config: 3,
};

/** A locally-persisted draft (from the IndexedDB draft store), by repo path. */
export interface DraftInput {
  path: string;
  body: string;
}

export interface ReconcileResult {
  /** The file list to show: loaded files plus any resurrected draft-only files, sorted. */
  files: AdvancedFile[];
  /** Working text per path (loaded content, overridden by a differing draft). */
  text: Map<string, string>;
  /** Valid drafts to re-queue to autosave (uncommitted edits + resurrected files). */
  requeue: { path: string; content: string }[];
}

/**
 * Reconcile the branch's loaded advanced files with locally-saved drafts (SPEC §8).
 *
 * Two cases:
 * - A draft for a **loaded** file that differs → the draft is an as-yet-uncommitted
 *   edit; use it as the working text and (if valid) re-queue it.
 * - A draft for a file **not** in the loaded tree → e.g. a freshly created content
 *   type whose commit hasn't landed on the branch yet. Resurface it so a too-soon
 *   reload never strands the draft. Only advanced-area paths qualify (`allForRepo`
 *   also returns content-object drafts, which `kindOf` rejects).
 *
 * Pure so it's unit-testable away from React + IndexedDB; {@link useAdvanced} feeds it
 * the loaded files and stored drafts and applies `requeue` through the autosaver.
 */
export function reconcileAdvancedDrafts(
  loadedFiles: AdvancedFile[],
  drafts: DraftInput[],
): ReconcileResult {
  const byPath = new Map(loadedFiles.map((f) => [f.path, f] as const));
  const text = new Map(loadedFiles.map((f) => [f.path, f.content]));
  const requeue: { path: string; content: string }[] = [];
  const extra: AdvancedFile[] = [];

  for (const draft of drafts) {
    const existing = byPath.get(draft.path);
    if (existing) {
      if (draft.body !== existing.content) {
        text.set(draft.path, draft.body);
        if (validateAdvancedFile({ ...existing, content: draft.body }).valid) {
          requeue.push({ path: draft.path, content: draft.body });
        }
      }
      continue;
    }
    const kind = kindOf(draft.path);
    if (!kind) continue; // a content-object draft (or any non-advanced path)
    const file: AdvancedFile = { path: draft.path, kind, content: draft.body };
    extra.push(file);
    text.set(draft.path, draft.body);
    if (validateAdvancedFile(file).valid) {
      requeue.push({ path: draft.path, content: draft.body });
    }
  }

  const files = extra.length
    ? [...loadedFiles, ...extra].sort(
        (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.path.localeCompare(b.path),
      )
    : loadedFiles;

  return { files, text, requeue };
}
