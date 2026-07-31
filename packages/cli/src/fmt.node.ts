import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatDocument } from '@timber/generator';
import { buildSnapshotFromDir } from './snapshot.node.js';

export interface FmtResult {
  /** Repo-relative paths that were not in canonical form. */
  changed: string[];
  /** How many object files were examined. */
  checked: number;
}

/**
 * Object files this command owns: the `index.md` of every content bundle, at any depth
 * (a singleton sits at `content/settings/`, an i18n variant at `content/posts/en/hello/`).
 */
const OBJECT_FILE = /^content\/.+\/index\.md$/;

/**
 * Normalise every content object to the form the editor writes (SPEC §4).
 *
 * A hand-authored or script-generated `index.md` whose bytes differ from
 * `serializeDocument`'s output — different YAML quoting or wrapping, a missing blank line
 * after the closing fence — is perfectly valid and builds correctly, but the editor
 * re-serialises it on load and the object shows as modified before anyone has typed
 * anything. Reverting doesn't help: it restores the non-canonical bytes and the cycle
 * repeats. So this is a *formatting* concern, deliberately separate from `validate`.
 *
 * With `write: false` (the CI check) nothing is touched and the offending paths are
 * returned; with `write: true` each is rewritten in place. Rendering is unaffected either
 * way — only the YAML's own formatting changes.
 */
export async function formatRepo(
  repoDir: string,
  { write }: { write: boolean },
): Promise<FmtResult> {
  const snapshot = await buildSnapshotFromDir(repoDir);
  const changed: string[] = [];
  let checked = 0;

  for (const path of [...snapshot.keys()].sort()) {
    if (!OBJECT_FILE.test(path)) continue;
    checked += 1;
    // Read from disk rather than the snapshot so the bytes compared are exactly the
    // bytes committed (the snapshot is already decoded UTF-8, which is the same here,
    // but re-reading keeps the write path honest about what it is replacing).
    const raw = await readFile(join(repoDir, path), 'utf8');
    const formatted = formatDocument(raw);
    if (formatted === raw) continue;
    changed.push(path);
    if (write) await writeFile(join(repoDir, path), formatted, 'utf8');
  }

  return { changed, checked };
}
