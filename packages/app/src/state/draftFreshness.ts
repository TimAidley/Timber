/**
 * Telling an unsaved edit from a draft the branch has moved past (SPEC §5's base-SHA
 * conflict check, applied to the IndexedDB layer).
 *
 * Load-time recovery re-applies any draft whose content differs from the branch copy.
 * On its own that rule cannot distinguish the two things a difference might mean:
 *
 * - **work that never got committed** — autosave hadn't flushed, the tab closed, the
 *   browser crashed. Restoring it is the entire point of the draft store; and
 * - **a draft older than what the branch now holds** — written on another device, or
 *   before someone else (or a direct push) changed that file. Restoring that *overwrites
 *   newer content*, silently, on a page the author may not even have open.
 *
 * Identical in shape, opposite in what the author wants. So a draft records the blob SHA
 * it was started from, and the two cases separate cleanly: the branch SHA still matching
 * means nothing else has touched the file and the draft is simply ahead of it; a changed
 * SHA means the file moved underneath the draft and only a human can say which wins.
 */

/** What the freshness check needs of a draft — the store's record, narrowed. */
export interface DraftBase {
  baseSha?: string | undefined;
}

/**
 * Whether `draft` was based on a version of the file the branch has since moved past.
 *
 * Deliberately conservative — it answers "is this definitely a conflict?", and anything
 * short of that is treated as ordinary unsaved work, because wrongly setting a draft
 * aside interrupts an author who has done nothing wrong:
 *
 * - **no `baseSha`** — a draft with no branch copy to conflict with (a newly created
 *   object whose first commit hasn't landed), or one written before the SHA was
 *   recorded. Neither is evidence of a conflict.
 * - **no current SHA** — the path isn't on the branch at all, so there is nothing for
 *   the draft to be stale against; it's the only copy.
 *
 * Callers must also have established that the draft's content actually *differs* from
 * the branch copy. A draft matching the branch byte-for-byte has nothing to resolve
 * however its SHA reads — which is what keeps a draft whose commit landed (but whose
 * cleanup didn't) from raising a conflict over content that is already published.
 */
export function isStaleDraft(draft: DraftBase, currentSha: string | undefined): boolean {
  if (draft.baseSha === undefined || currentSha === undefined) return false;
  return draft.baseSha !== currentSha;
}
