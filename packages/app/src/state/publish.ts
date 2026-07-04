import {
  assembleContent,
  loadSchemas,
  canPublish,
  Validator,
  type RepoSnapshot,
} from '@timber/content';
import type { ChangedPath, RepoTree, TreeOverlayEntry } from '@timber/github';

/**
 * The subset of RepoClient the publisher needs (RepoClient satisfies it
 * structurally). Declaring it here keeps planPublish/runPublish unit-testable with
 * a fake client, no network — the same split used for the Autosaver.
 */
export interface PublishClient {
  getBranchSha(branch: string): Promise<string | undefined>;
  compareChangedPaths(base: string, head: string): Promise<ChangedPath[]>;
  treeShaOf(commitSha: string): Promise<string>;
  loadTree(ref: string): Promise<RepoTree>;
  loadSnapshot(ref: string): Promise<RepoSnapshot>;
  overlayTree(baseTreeSha: string, entries: TreeOverlayEntry[]): Promise<string>;
  commitTree(input: {
    branch: string;
    message: string;
    treeSha: string;
    parents: string[];
  }): Promise<{ sha: string }>;
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
  | { kind: 'conflict'; paths: string[] };

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
    ? `Update ${changed[0]!.path.replace(/\/index\.md$/, '').split('/').pop() ?? changed[0]!.path}`
    : `Update site: ${changed.length} changes`;
}

/**
 * Decide how (or whether) to publish WIP→main (SPEC §11). Runs the pre-publish
 * validity gate (no invalid *public* object may reach main — SPEC §5), then picks a
 * strategy: clean squash if main hasn't moved; rebase if main moved but the changed
 * files don't overlap; block if the same file diverged on both sides.
 */
export async function planPublish(client: PublishClient, ctx: PublishContext): Promise<PublishPlan> {
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
  if (invalid.length > 0) return { ok: false, block: { kind: 'invalid', objects: invalid } };

  // Strategy / conflict detection.
  if (currentMain === ctx.baseSha) {
    return { ok: true, strategy: 'clean', changed, currentMain, wipTip, wipChanged: changed };
  }

  const mainChanged = await client.compareChangedPaths(ctx.baseSha, ctx.defaultBranch);
  const wipChanged = await client.compareChangedPaths(ctx.baseSha, ctx.wipBranch);
  const mainPaths = new Set(mainChanged.map((c) => c.path));
  const overlap = wipChanged.filter((c) => mainPaths.has(c.path)).map((c) => c.path);
  if (overlap.length > 0) return { ok: false, block: { kind: 'conflict', paths: overlap } };

  return { ok: true, strategy: 'rebase', changed, currentMain, wipTip, wipChanged };
}

/**
 * Execute an approved {@link PublishPlan}: squash-merge onto the default branch, then
 * reset WIP to the new tip. Returns the new default-branch SHA (the caller updates
 * `session.baseSha` and clears local drafts).
 */
export async function runPublish(
  client: PublishClient,
  ctx: PublishContext,
  plan: Extract<PublishPlan, { ok: true }>,
  message: string,
): Promise<{ sha: string }> {
  let treeSha: string;
  if (plan.strategy === 'clean') {
    // WIP was built on the (unchanged) main tip, so its tree IS the squash result.
    treeSha = await client.treeShaOf(plan.wipTip);
  } else {
    // Rebase: main's tree with WIP's changed files overlaid on top.
    const mainTree = await client.treeShaOf(plan.currentMain);
    const wipTree = await client.loadTree(ctx.wipBranch);
    const wipByPath = new Map(
      wipTree.entries.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]),
    );
    const entries: TreeOverlayEntry[] = [];
    for (const c of plan.wipChanged) {
      if (c.status === 'removed') {
        entries.push({ path: c.path, sha: null });
        continue;
      }
      const sha = wipByPath.get(c.path);
      if (sha) entries.push({ path: c.path, sha });
      if (c.previousPath) entries.push({ path: c.previousPath, sha: null }); // renamed: drop old
    }
    treeSha = await client.overlayTree(mainTree, entries);
  }

  const { sha } = await client.commitTree({
    branch: ctx.defaultBranch,
    message,
    treeSha,
    parents: [plan.currentMain],
  });
  await client.resetBranch(ctx.wipBranch, sha);
  return { sha };
}
