import type { ChangedPath, HostProvider, RepoTree, TreeEntry } from '@timber/host';
import {
  assembleContent,
  loadSchemas,
  type ContentModel,
  type ContentObject,
  type ContentTypeSchema,
  type RepoSnapshot,
} from '@timber/content';
import { getToken } from '../github/auth.js';
import { repoConfig } from '../github/config.js';
import { createHostProvider } from '../github/hostProvider.js';

/**
 * An open editing session against the configured host repo (SPEC §11). Content is loaded
 * from the user's `<login>_wip` branch if it exists (their durable, portable
 * in-progress work), else from the default branch. `baseSha` records the
 * default-branch tip the WIP is based on — Phase 5b's conflict check needs it.
 */
export interface RepoSession {
  client: HostProvider;
  login: string;
  /** The per-user WIP branch name, `<login>_wip` (SPEC §11). */
  wipBranch: string;
  defaultBranch: string;
  /** Default-branch tip the WIP session is based on (for 5b conflict detection). */
  baseSha: string;
  /** Which branch the loaded snapshot came from (wip if it existed, else default). */
  loadedRef: string;
  model: ContentModel;
  /**
   * The loaded branch's full file tree (paths + blob SHAs). Object delete/rename read
   * it to find a bundle's colocated asset paths and reuse their blob SHAs on move.
   */
  treeEntries: TreeEntry[];
  /**
   * Objects present on the default branch but **removed on the WIP branch** — pending
   * deletions committed in a prior session. Derived from the `main…wip` diff so they
   * survive reloads (the editor shows them struck-through, with Restore). Each carries
   * the object (reconstructed from the still-present default-branch copy) and its
   * colocated asset SHAs, so a restore can re-attach the bytes without re-uploading.
   */
  deletedObjects: DeletedObject[];
}

export interface DeletedObject {
  object: ContentObject;
  assets: { path: string; sha: string }[];
}

// A collection object's index.md: content/<type>/<slug>/index.md (singletons — one
// path segment — are never user-deletable, so pending deletions are always collections).
const OBJECT_INDEX = /^content\/[^/]+\/[^/]+\/index\.md$/;

/** The minimal slice of the host port the deletion-derivation needs (fakeable in tests). */
export interface PendingDeletionDeps {
  compareChangedPaths: (base: string, head: string) => Promise<ChangedPath[]>;
  loadTree: (ref: string) => Promise<RepoTree>;
  readFile: (path: string, ref: string) => Promise<string>;
}

/**
 * Reconstruct pending deletions from the branch itself: an object `index.md` that
 * exists on `defaultBranch` but is `removed` on `wipBranch`. The removed objects still
 * live on the default branch (the deletion isn't published), so we read them there to
 * rebuild the struck-through entry + restore payload, and pull their bundle assets'
 * blob SHAs from the default-branch tree (they're gone from WIP).
 */
export async function derivePendingDeletions(
  deps: PendingDeletionDeps,
  defaultBranch: string,
  wipBranch: string,
  schemas: Map<string, ContentTypeSchema>,
): Promise<DeletedObject[]> {
  const changed = await deps.compareChangedPaths(defaultBranch, wipBranch);
  const removed = changed
    .filter((c) => c.status === 'removed' && OBJECT_INDEX.test(c.path))
    .map((c) => c.path);
  if (removed.length === 0) return [];

  const defaultTree = await deps.loadTree(defaultBranch);
  const miniSnapshot: RepoSnapshot = new Map(
    await Promise.all(removed.map(async (path): Promise<[string, string]> => [path, await deps.readFile(path, defaultBranch)])),
  );
  // Reuse the real assembly (kind/slug/id/visibility) rather than re-parsing by hand.
  const model = assembleContent(miniSnapshot, schemas);

  return model.objects.map((object) => {
    const bundleDir = object.path.replace(/\/index\.md$/, '');
    const assets = defaultTree.entries
      .filter((e) => e.type === 'blob' && e.path.startsWith(`${bundleDir}/`) && e.path !== object.path)
      .map((e) => ({ path: e.path, sha: e.sha }));
    return { object, assets };
  });
}

/**
 * Connect to the configured host repo and assemble its content model in-browser — the
 * same `loadSchemas` + `assembleContent` the CLI runs, but fed by the host port's
 * `loadSnapshot` instead of the filesystem. Replaces the bundled demo repo as the
 * editor's content source.
 */
export async function loadRepoSession(): Promise<RepoSession> {
  const client = createHostProvider({ owner: repoConfig.owner, repo: repoConfig.repo }, getToken);

  const login = await client.getAuthenticatedLogin();
  const defaultBranch = await client.getDefaultBranch();

  const baseSha = await client.getBranchSha(defaultBranch);
  if (!baseSha) throw new Error(`Default branch "${defaultBranch}" not found`);

  // Resolve the WIP branch tolerant of login casing: GitHub returns the login in its
  // canonical case (`TimAidley`) but the branch may have been created lowercase
  // (`timaidley_wip`), and a case-sensitive git ref lookup would miss it — loading `main`
  // and, worse, forking a second `<canonical>_wip` on the next autosave. Bind the session
  // to the branch's ACTUAL name so every commit reuses it; fall back to the canonical
  // name for the not-yet-created case.
  const wip = await client.resolveBranch(`${login}_wip`);
  const wipBranch = wip?.name ?? `${login}_wip`;
  const wipSha = wip?.sha;
  const loadedRef = wipSha ? wipBranch : defaultBranch;

  const { snapshot, tree } = await client.loadSnapshotWithTree(loadedRef);
  const schemas = loadSchemas(snapshot);
  const model = assembleContent(snapshot, schemas);

  // Only the WIP branch can carry pending deletions (a removal relative to main); when
  // we loaded straight from the default branch there's nothing removed to reconstruct.
  const deletedObjects = wipSha
    ? await derivePendingDeletions(client, defaultBranch, wipBranch, schemas)
    : [];

  return {
    client,
    login,
    wipBranch,
    defaultBranch,
    baseSha,
    loadedRef,
    model,
    treeEntries: tree.entries,
    deletedObjects,
  };
}
