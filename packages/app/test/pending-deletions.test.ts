import { describe, expect, it, vi } from 'vitest';
import type { ChangedPath, RepoTree } from '@timber/github';
import type { ContentTypeSchema } from '@timber/content';
import { derivePendingDeletions, type PendingDeletionDeps } from '../src/state/repoSession.js';

const schemas = new Map<string, ContentTypeSchema>([
  ['events', { name: 'events', kind: 'collection', fields: {} }],
]);

function tree(paths: string[]): RepoTree {
  return {
    ref: 'main',
    commitSha: 'C',
    treeSha: 'T',
    entries: paths.map((path) => ({ path, type: 'blob' as const, sha: `sha:${path}` })),
  };
}

describe('derivePendingDeletions (branch-derived pending deletes, SPEC §5)', () => {
  it('reconstructs a removed object from main + gathers its asset SHAs', async () => {
    const changed: ChangedPath[] = [
      { path: 'content/events/gone/index.md', status: 'removed' },
      { path: 'content/events/gone/hero.webp', status: 'removed' },
      { path: 'content/events/kept/index.md', status: 'modified' }, // an edit, not a delete
    ];
    const deps: PendingDeletionDeps = {
      compareChangedPaths: vi.fn(async () => changed),
      loadTree: vi.fn(async () => tree(['content/events/gone/index.md', 'content/events/gone/hero.webp'])),
      readFile: vi.fn(async () => '---\nid: ev1\ntitle: Gone\n---\nbody\n'),
    };

    const deleted = await derivePendingDeletions(deps, 'main', 'octocat_wip', schemas);

    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.object.path).toBe('content/events/gone/index.md');
    expect(deleted[0]!.object.data.title).toBe('Gone');
    expect(deleted[0]!.object.slug).toBe('gone');
    // Reads from the DEFAULT branch (the object still exists there, unpublished).
    expect(deps.readFile).toHaveBeenCalledWith('content/events/gone/index.md', 'main');
    // The colocated asset comes through with its blob SHA for a no-re-upload restore.
    expect(deleted[0]!.assets).toEqual([
      { path: 'content/events/gone/hero.webp', sha: 'sha:content/events/gone/hero.webp' },
    ]);
  });

  it('ignores non-removed changes and skips the tree read when nothing was deleted', async () => {
    const deps: PendingDeletionDeps = {
      compareChangedPaths: vi.fn(async () => [
        { path: 'content/events/kept/index.md', status: 'modified' },
      ]),
      loadTree: vi.fn(async () => tree([])),
      readFile: vi.fn(async () => ''),
    };

    const deleted = await derivePendingDeletions(deps, 'main', 'octocat_wip', schemas);

    expect(deleted).toEqual([]);
    expect(deps.loadTree).not.toHaveBeenCalled();
    expect(deps.readFile).not.toHaveBeenCalled();
  });
});
