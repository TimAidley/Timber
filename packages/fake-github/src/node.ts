import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { CommitObject } from './objects.js';
import type { FakeRepo } from './repo.js';

/** Directory names never seeded — a `.git` from a real checkout would poison the tree. */
const SKIP_DIRS = new Set(['.git', 'node_modules']);

/**
 * Commit every file under `dir` onto a branch of the fake repo — the way a test or a
 * virtual-user run gets a realistic content repo: point it at `site-template/` and the
 * editor loads the same schemas, theme and sample content a real fork-and-go site has.
 * Node-only (filesystem), hence its own entry point.
 */
export async function seedRepoFromDir(
  repo: FakeRepo,
  dir: string,
  options: { branch?: string; message?: string } = {},
): Promise<CommitObject> {
  const files: Record<string, Uint8Array> = {};
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile()) {
        files[relative(dir, full).split(sep).join('/')] = new Uint8Array(
          await readFile(full),
        );
      }
    }
  };
  await walk(dir);
  return repo.writeFiles(
    options.branch ?? repo.defaultBranch,
    files,
    options.message ?? `Seed from ${dir}`,
  );
}
