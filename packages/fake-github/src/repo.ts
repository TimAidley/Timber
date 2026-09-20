import { FakeActions, type ActionsOptions } from './actions.js';
import { GitStore, type CommitObject, type GitIdentity } from './objects.js';

export interface FakeRepoOptions {
  owner: string;
  repo: string;
  /** Default `main`. */
  defaultBranch?: string;
  /** Default `false` (public). */
  private?: boolean;
  /**
   * The workflow file whose runs the fake creates on a push to the default branch or a
   * `workflow_dispatch` — the site-template's `deploy.yml`. Other workflow files are
   * ignored: the client only ever asks about this one.
   */
  deployWorkflow?: string;
  actions?: ActionsOptions;
}

/** Text or bytes to write — mirrors the client's `FileWrite` but keyed by path. */
export type FileMap = Record<string, string | Uint8Array>;

export class RefConflictError extends Error {}

const encoder = new TextEncoder();

/** The default identity stamped on commits the fake creates itself (seed, foreign pushes). */
const FAKE_IDENTITY: Omit<GitIdentity, 'date'> = {
  name: 'Fake GitHub',
  email: 'fake@github.invalid',
};

/**
 * One repository inside the fake: an object store plus the mutable bits GitHub layers
 * on top of it — refs, metadata (default branch, visibility) and an Actions history.
 *
 * Beyond serving the REST router, it exposes **semantic** helpers a test or harness
 * reaches for directly: `writeFiles` to seed content or simulate *someone else* pushing
 * (the foreign-write case the editor must notice), `readFile` to assert what a publish
 * actually landed on `main`. These bypass the HTTP layer on purpose — they're the
 * "world outside the browser", not the client under test.
 */
export class FakeRepo {
  readonly owner: string;
  readonly name: string;
  readonly store = new GitStore();
  readonly refs = new Map<string, string>();
  readonly actions: FakeActions;
  readonly deployWorkflow: string;
  defaultBranch: string;
  private: boolean;

  constructor(options: FakeRepoOptions) {
    this.owner = options.owner;
    this.name = options.repo;
    this.defaultBranch = options.defaultBranch ?? 'main';
    this.private = options.private ?? false;
    this.deployWorkflow = options.deployWorkflow ?? 'deploy.yml';
    this.actions = new FakeActions({
      htmlBase: `https://github.com/${this.owner}/${this.name}`,
      ...options.actions,
    });
  }

  get fullName(): string {
    return `${this.owner}/${this.name}`;
  }

  // --- refs ------------------------------------------------------------------

  /** Normalize `heads/x`, `refs/heads/x` or bare `x` to `refs/heads/x`. */
  static refName(ref: string): string {
    if (ref.startsWith('refs/')) return ref;
    if (ref.startsWith('heads/')) return `refs/${ref}`;
    return `refs/heads/${ref}`;
  }

  getRef(ref: string): string | undefined {
    return this.refs.get(FakeRepo.refName(ref));
  }

  /** Branch names with their tips, in name order (what `GET /branches` lists). */
  listBranches(): { name: string; sha: string }[] {
    return [...this.refs]
      .filter(([ref]) => ref.startsWith('refs/heads/'))
      .map(([ref, sha]) => ({ name: ref.slice('refs/heads/'.length), sha }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  /** `POST /git/refs`: create a ref; a duplicate is a 422 like GitHub's. */
  createRef(ref: string, sha: string): void {
    const name = FakeRepo.refName(ref);
    if (this.refs.has(name)) throw new RefConflictError('Reference already exists');
    if (!this.store.hasCommit(sha)) throw new RefConflictError('Object does not exist');
    this.refs.set(name, sha);
    this.afterRefMove(name, sha, 'push');
  }

  /**
   * `PATCH /git/refs/:ref`: move a ref. Without `force` the move must be a fast-forward —
   * the current tip an ancestor of the new sha — else GitHub's exact 422 wording, which
   * the client's retry loop matches on.
   */
  updateRef(ref: string, sha: string, force = false): void {
    const name = FakeRepo.refName(ref);
    const current = this.refs.get(name);
    if (current === undefined) throw new RefConflictError('Reference does not exist');
    if (!this.store.hasCommit(sha)) throw new RefConflictError('Object does not exist');
    if (!force && !this.store.isAncestor(current, sha)) {
      throw new RefConflictError('Update is not a fast forward');
    }
    this.refs.set(name, sha);
    if (current !== sha) this.afterRefMove(name, sha, 'push');
  }

  /** Delete a branch — the world outside the editor tidying up. */
  deleteRef(ref: string): void {
    this.refs.delete(FakeRepo.refName(ref));
  }

  /**
   * Listeners told after any ref moves (`refs/heads/x`, new sha) — however it moved: the
   * REST API, `writeFiles`, or `createRef`. A launcher uses this to build the site when
   * the default branch changes, the way a push would trigger CI.
   */
  readonly onRefMove: ((ref: string, sha: string) => void)[] = [];

  /** A push to the default branch is what triggers the deploy workflow (`on: push: [main]`). */
  private afterRefMove(name: string, sha: string, event: 'push'): void {
    for (const listener of this.onRefMove) listener(name, sha);
    if (name !== `refs/heads/${this.defaultBranch}`) return;
    this.actions.createRun({
      workflowFile: this.deployWorkflow,
      event,
      headBranch: this.defaultBranch,
      headSha: sha,
    });
  }

  /** `POST /actions/workflows/:file/dispatches`. */
  dispatchWorkflow(workflowFile: string, ref: string): void {
    const sha = this.getRef(ref) ?? (this.store.hasCommit(ref) ? ref : undefined);
    if (!sha) throw new RefConflictError(`No ref found for: ${ref}`);
    if (workflowFile !== this.deployWorkflow) return; // not a workflow the fake models
    this.actions.createRun({
      workflowFile,
      event: 'workflow_dispatch',
      headBranch: ref.replace(/^refs\/heads\//, ''),
      headSha: sha,
    });
  }

  // --- semantic helpers (bypass HTTP) -------------------------------------------

  private identity(): GitIdentity {
    return { ...FAKE_IDENTITY, date: new Date(this.actions.now()).toISOString() };
  }

  /**
   * Commit files onto a branch (creating it from the default branch, or empty when there
   * is no default branch yet). `null` removes a path. Returns the new commit. This is how
   * a test seeds the repo and how a harness plays "another device pushed".
   */
  async writeFiles(
    branch: string,
    files: Record<string, string | Uint8Array | null>,
    message = 'Update files',
  ): Promise<CommitObject> {
    const ref = FakeRepo.refName(branch);
    let parent = this.refs.get(ref);
    if (parent === undefined && branch !== this.defaultBranch)
      parent = this.getRef(this.defaultBranch);

    const overlays = await Promise.all(
      Object.entries(files).map(async ([path, content]) => ({
        path,
        sha:
          content === null
            ? null
            : await this.store.putBlob(
                typeof content === 'string' ? encoder.encode(content) : content,
              ),
      })),
    );
    const baseTree = parent ? this.store.getCommit(parent)?.tree : undefined;
    const tree = await this.store.overlayTree(baseTree, overlays);
    const commit = await this.store.putCommit({
      tree,
      parents: parent ? [parent] : [],
      message,
      author: this.identity(),
    });
    this.refs.set(ref, commit.sha);
    this.afterRefMove(ref, commit.sha, 'push');
    return commit;
  }

  /** Read a text file at a branch tip (or commit sha); undefined if absent. */
  readFile(path: string, ref = this.defaultBranch): string | undefined {
    const bytes = this.readBytes(path, ref);
    return bytes ? new TextDecoder().decode(bytes) : undefined;
  }

  readBytes(path: string, ref = this.defaultBranch): Uint8Array | undefined {
    const commitSha = this.getRef(ref) ?? ref;
    const commit = this.store.getCommit(commitSha);
    if (!commit) return undefined;
    const blob = this.store.blobsOf(commit.tree).get(path);
    return blob ? this.store.getBlob(blob.sha) : undefined;
  }

  /** All file paths at a branch tip, sorted. */
  listFiles(ref = this.defaultBranch): string[] {
    const commit = this.store.getCommit(this.getRef(ref) ?? ref);
    if (!commit) return [];
    return [...this.store.blobsOf(commit.tree).keys()].sort();
  }

  /** The commit log of a branch, newest first (first-parent). */
  log(ref = this.defaultBranch): CommitObject[] {
    const out: CommitObject[] = [];
    let sha = this.getRef(ref) ?? ref;
    for (;;) {
      const commit = this.store.getCommit(sha);
      if (!commit) break;
      out.push(commit);
      const [first] = commit.parents;
      if (!first) break;
      sha = first;
    }
    return out;
  }
}
