import { RepoClient, type TreeEntry } from '@timber/github';
import { assembleContent, loadSchemas, type ContentModel } from '@timber/content';
import { getToken } from '../github/auth.js';
import { repoConfig } from '../github/config.js';

/**
 * An open editing session against a real GitHub repo (SPEC §11). Content is loaded
 * from the user's `<login>_wip` branch if it exists (their durable, portable
 * in-progress work), else from the default branch. `baseSha` records the
 * default-branch tip the WIP is based on — Phase 5b's conflict check needs it.
 */
export interface RepoSession {
  client: RepoClient;
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
}

/**
 * Connect to the configured repo and assemble its content model in-browser — the
 * same `loadSchemas` + `assembleContent` the CLI runs, but fed by
 * `RepoClient.loadSnapshot` instead of the filesystem. Replaces the bundled demo
 * repo as the editor's content source.
 */
export async function loadRepoSession(): Promise<RepoSession> {
  const client = new RepoClient({ owner: repoConfig.owner, repo: repoConfig.repo, getToken });

  const login = await client.getAuthenticatedLogin();
  const wipBranch = `${login}_wip`;
  const defaultBranch = await client.getDefaultBranch();

  const baseSha = await client.getBranchSha(defaultBranch);
  if (!baseSha) throw new Error(`Default branch "${defaultBranch}" not found`);

  const wipSha = await client.getBranchSha(wipBranch);
  const loadedRef = wipSha ? wipBranch : defaultBranch;

  const { snapshot, tree } = await client.loadSnapshotWithTree(loadedRef);
  const schemas = loadSchemas(snapshot);
  const model = assembleContent(snapshot, schemas);

  return { client, login, wipBranch, defaultBranch, baseSha, loadedRef, model, treeEntries: tree.entries };
}
