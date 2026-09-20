import {
  assembleContent,
  loadSchemas,
  canPublish,
  Validator,
  type RepoSnapshot,
} from '@timber/content';
import type {
  ChangedPath,
  CommitResult,
  PublishSquashInput,
  RefComparison,
} from '@timber/host';

/**
 * The subset of the host port the publisher needs (a {@link HostProvider} satisfies it
 * structurally). Declaring it here keeps planPublish/runPublish unit-testable with a
 * fake client, no network — the same split used for the Autosaver. The publish *decision*
 * (validity gate, clean-vs-rebase, conflict detection) is host-neutral and lives here;
 * the host-specific mechanics of building the squash commit live behind `publishSquash`.
 */
export interface PublishClient {
  getBranchSha(branch: string): Promise<string | undefined>;
  compareChangedPaths(base: string, head: string): Promise<ChangedPath[]>;
  /** How WIP stands relative to the default branch — the ancestry the strategy turns on. */
  compareRefs(base: string, head: string): Promise<RefComparison>;
  loadSnapshot(ref: string): Promise<RepoSnapshot>;
  publishSquash(input: PublishSquashInput): Promise<CommitResult>;
  /** Force-move a branch to a SHA — used to catch a behind WIP up to the default branch. */
  resetBranch(branch: string, toSha: string): Promise<void>;
}

export interface PublishContext {
  wipBranch: string;
  defaultBranch: string;
  /** The default-branch tip the WIP session started from (conflict base). */
  baseSha: string;
}

/** Why a publish can't proceed (SPEC §11 detect-don't-resolve; SPEC §5 validity gate). */
export type PublishBlock =
  | { kind: 'nothing' }
  | { kind: 'invalid'; objects: string[] }
  | { kind: 'conflict'; paths: string[] }
  /**
   * WIP holds nothing the default branch doesn't — every difference between them is the
   * default branch being *newer* (a direct push, another clone, a co-author). Publishing
   * would write WIP's older tree over it. Nothing to publish; WIP wants catching up.
   */
  | { kind: 'behind'; behindBy: number };

export type PublishPlan =
  | {
      ok: true;
      strategy: 'clean' | 'rebase';
      changed: ChangedPath[];
      currentMain: string;
      wipTip: string;
      /** WIP's changes since base, for the rebase overlay (rebase only). */
      wipChanged: ChangedPath[];
    }
  | { ok: false; block: PublishBlock };

/** A human default commit message for the publish. */
export function describePublish(changed: ChangedPath[]): string {
  return changed.length === 1
    ? `Update ${
        changed[0]!.path
          .replace(/\/index\.md$/, '')
          .split('/')
          .pop() ?? changed[0]!.path
      }`
    : `Update site: ${changed.length} changes`;
}

/**
 * Decide how (or whether) to publish WIP→main (SPEC §11). Runs the pre-publish
 * validity gate (no invalid *public* object may reach main — SPEC §5), then picks a
 * strategy: clean squash if main hasn't moved; rebase if main moved but the changed
 * files don't overlap; block if the same file diverged on both sides.
 */
export async function planPublish(
  client: PublishClient,
  ctx: PublishContext,
): Promise<PublishPlan> {
  const wipTip = await client.getBranchSha(ctx.wipBranch);
  if (!wipTip) return { ok: false, block: { kind: 'nothing' } };

  const currentMain = await client.getBranchSha(ctx.defaultBranch);
  if (!currentMain) throw new Error(`Default branch "${ctx.defaultBranch}" not found`);

  const changed = await client.compareChangedPaths(ctx.defaultBranch, ctx.wipBranch);
  if (changed.length === 0) return { ok: false, block: { kind: 'nothing' } };

  // Validity gate: validate the exact content being published (fresh WIP snapshot).
  const snapshot = await client.loadSnapshot(ctx.wipBranch);
  const schemas = loadSchemas(snapshot);
  const model = assembleContent(snapshot, schemas);
  const validator = new Validator(schemas);
  const invalid = model.objects
    .filter((o) => o.public && !canPublish(validator.validateObject(o, model)))
    .map((o) => o.path);
  if (invalid.length > 0)
    return { ok: false, block: { kind: 'invalid', objects: invalid } };

  // Strategy / conflict detection, decided on ANCESTRY — does WIP actually contain the
  // default branch? — not on whether main moved since this session loaded.
  //
  // Those two questions come apart exactly when the default branch gains a commit from
  // outside this editor, and getting them confused is a data-loss bug, not a nicety:
  // `clean` hands WIP's tree to the squash wholesale, so publishing a WIP that is behind
  // rewrites main back to WIP's older content. The old test (`currentMain ===
  // ctx.baseSha`) is true for *every fresh session* — `baseSha` is read at load — so a
  // reload made it more likely to fire, not less. It reverted a pushed fix five times.
  const rel = await client.compareRefs(ctx.defaultBranch, ctx.wipBranch);

  if (rel.status === 'behind' || rel.status === 'identical') {
    // Nothing of WIP's own: every difference is main being ahead. Publishing could only
    // undo it. The caller catches WIP up instead — see {@link catchUpWip}.
    return { ok: false, block: { kind: 'behind', behindBy: rel.behindBy } };
  }

  if (rel.status === 'ahead') {
    // WIP contains main's tip, so its tree already includes everything on main: the
    // squash can take it wholesale. This is the only case where that is sound.
    return {
      ok: true,
      strategy: 'clean',
      changed,
      currentMain,
      wipTip,
      wipChanged: changed,
    };
  }

  // Diverged: both moved since they parted. Overlap is a real conflict; otherwise WIP's
  // own changes overlay main's current tree, which keeps main-only files intact.
  //
  // Measured from the **merge base** where the host reports one. `ctx.baseSha` is only
  // the default branch as this session loaded it, which is not the fork point once main
  // has moved — using it would count main's newer files as WIP "changes" and overlay the
  // older versions back over them, the same revert by another route.
  const forkPoint = rel.mergeBaseSha ?? ctx.baseSha;
  const mainChanged = await client.compareChangedPaths(forkPoint, ctx.defaultBranch);
  const wipChanged = await client.compareChangedPaths(forkPoint, ctx.wipBranch);
  const mainPaths = new Set(mainChanged.map((c) => c.path));
  const overlap = wipChanged.filter((c) => mainPaths.has(c.path)).map((c) => c.path);
  if (overlap.length > 0)
    return { ok: false, block: { kind: 'conflict', paths: overlap } };

  return { ok: true, strategy: 'rebase', changed, currentMain, wipTip, wipChanged };
}

/**
 * The result of executing a plan: the new default-branch SHA, or `stale` when the WIP
 * branch moved after the plan was made and the plan must be rebuilt before publishing.
 */
export type PublishOutcome = { ok: true; sha: string } | { ok: false; reason: 'stale' };

/**
 * Execute an approved {@link PublishPlan}: hand the plan to the host's intent-level
 * {@link PublishClient.publishSquash}, which squash-merges onto the default branch and
 * resets WIP to the new tip. Returns the new default-branch SHA (the caller updates
 * `session.baseSha` and clears local drafts). The tree mechanics (clean reuse vs rebase
 * overlay) are the adapter's job — see the host port's `publishSquash`.
 *
 * A plan pins the WIP tip it was built from, and that tip can move between planning and
 * confirming — a debounced autosave landing, another tab, a slow reader. Publishing the
 * pinned tip then ships a tree one commit **behind** the branch (and behind the diff the
 * author just reviewed), and the WIP reset that follows bounces those newer changes back
 * as unpublished. So the tip is re-checked here, at the point of no return, and a moved
 * branch returns `stale` for the caller to re-plan rather than publishing the wrong tree.
 */
export async function runPublish(
  client: PublishClient,
  ctx: PublishContext,
  plan: Extract<PublishPlan, { ok: true }>,
  message: string,
): Promise<PublishOutcome> {
  const tip = await client.getBranchSha(ctx.wipBranch);
  if (tip !== plan.wipTip) return { ok: false, reason: 'stale' };

  const { sha } = await client.publishSquash({
    defaultBranch: ctx.defaultBranch,
    wipBranch: ctx.wipBranch,
    parentSha: plan.currentMain,
    wipTip: plan.wipTip,
    message,
    strategy: plan.strategy,
    changes: plan.wipChanged,
  });
  return { ok: true, sha };
}

/**
 * Catch a behind WIP branch up to the default branch (the `behind` block above).
 *
 * WIP holding nothing of its own means there is nothing to merge and nothing to lose —
 * the only difference is commits the default branch gained elsewhere — so moving WIP onto
 * it is the whole repair. The editor then reloads from a WIP that genuinely contains
 * main, and the next publish is a sound `clean` squash rather than a revert.
 *
 * Deliberately narrow: the caller may only reach here on a `behind` block, never on
 * `diverged`, where WIP *does* hold work and a force-move would destroy it.
 */
export async function catchUpWip(
  client: PublishClient,
  ctx: PublishContext,
): Promise<string> {
  const currentMain = await client.getBranchSha(ctx.defaultBranch);
  if (!currentMain) throw new Error(`Default branch "${ctx.defaultBranch}" not found`);
  await client.resetBranch(ctx.wipBranch, currentMain);
  return currentMain;
}
