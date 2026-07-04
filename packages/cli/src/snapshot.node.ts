import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { RepoSnapshot } from '@timber/content';

/** Text files the content model reads; binary assets are irrelevant to it. */
const TEXT_FILE = /\.(md|ya?ml)$/;

/** Repo subtrees the content model cares about (content bundles + schemas/config). */
const ROOTS = ['content', 'config'];

async function walk(root: string, dir: string, snapshot: RepoSnapshot): Promise<void> {
  // A missing content/ or config/ dir is fine — just nothing to add.
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, abs, snapshot);
    } else if (TEXT_FILE.test(entry.name)) {
      const rel = relative(root, abs).split(sep).join('/');
      snapshot.set(rel, await readFile(abs, 'utf8'));
    }
  }
}

/**
 * Build a {@link RepoSnapshot} from a content repo on disk, reading `content/` and
 * `config/` text files into memory keyed by repo-relative posix path. This is the
 * Node counterpart to what the browser will build from RepoClient.loadTree (Phase 4).
 */
export async function buildSnapshotFromDir(repoDir: string): Promise<RepoSnapshot> {
  const snapshot: RepoSnapshot = new Map();
  for (const rootName of ROOTS) {
    await walk(repoDir, join(repoDir, rootName), snapshot);
  }
  return snapshot;
}
