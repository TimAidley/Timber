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

  // On a multilingual site every collection object lives at the four-segment
  // content/<type>/<lang>/<slug>/index.md. A hand-rolled three-segment regex here once
  // missed them all: a deleted translation reloaded with no struck-through entry and no
  // Restore, its removed paths dangling as unclassifiable "site files".
  it('reconstructs a removed multilingual object (content/<type>/<lang>/<slug>/)', async () => {
    const changed: ChangedPath[] = [
      { path: 'content/events/fr/fete/index.md', status: 'removed' },
      { path: 'content/events/fr/fete/hero.webp', status: 'removed' },
    ];
    const deps: PendingDeletionDeps = {
      compareChangedPaths: vi.fn(async () => changed),
      loadTree: vi.fn(async () =>
        tree(['content/events/fr/fete/index.md', 'content/events/fr/fete/hero.webp']),
      ),
      readFile: vi.fn(async () => '---\nid: ev2\ntitle: Fête\nlang: fr\n---\nbody\n'),
    };

    const deleted = await derivePendingDeletions(deps, 'main', 'octocat_wip', schemas);

    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.object.path).toBe('content/events/fr/fete/index.md');
    expect(deleted[0]!.object.slug).toBe('fete');
    expect(deleted[0]!.object.lang).toBe('fr');
    expect(deleted[0]!.assets).toEqual([
      { path: 'content/events/fr/fete/hero.webp', sha: 'sha:content/events/fr/fete/hero.webp' },
    ]);
  });

  it('still ignores a removed singleton (never user-deletable)', async () => {
    const deps: PendingDeletionDeps = {
      compareChangedPaths: vi.fn(async () => [
        { path: 'content/settings/index.md', status: 'removed' as const },
      ]),
      loadTree: vi.fn(async () => tree([])),
      readFile: vi.fn(async () => ''),
    };

    expect(await derivePendingDeletions(deps, 'main', 'octocat_wip', schemas)).toEqual([]);
    expect(deps.loadTree).not.toHaveBeenCalled();
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
