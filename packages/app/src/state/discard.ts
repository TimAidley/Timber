import type { ChangedPath, MoveEntry } from '@timber/github';

export interface BundleResetPlan {
  /** Files to reset to main's blob (present on main, changed/removed on WIP). */
  moves: MoveEntry[];
  /** WIP-only files (added on WIP, absent from main) to delete. */
  deletions: string[];
}

/**
 * Plan the commit that reverts a bundle's WIP state back to `main` (SPEC §5 discard).
 * Given the bundle's changed paths (from the `main…wip` diff) and main's blob SHA per
 * path, each file that exists on main (`modified`/`removed` on WIP) is reset to its
 * main blob via a **self-move** (`from === to` — re-add, no re-upload), and each
 * WIP-only file (`added`) is deleted. The net effect: the bundle matches main again.
 */
export function planBundleReset(
  bundleChanges: readonly ChangedPath[],
  mainShaByPath: ReadonlyMap<string, string>,
): BundleResetPlan {
  const moves: MoveEntry[] = [];
  const deletions: string[] = [];
  for (const change of bundleChanges) {
    if (change.status === 'added') {
      deletions.push(change.path);
      continue;
    }
    const sha = mainShaByPath.get(change.path);
    if (sha) moves.push({ from: change.path, to: change.path, sha });
  }
  return { moves, deletions };
}
