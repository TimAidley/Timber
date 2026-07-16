import { describe, expect, it } from 'vitest';
import { planRebaseOverlay } from '../src/index.js';
import type { ChangedPath, TreeEntry } from '../src/index.js';

// The publish rebase overlay (SPEC §11). This logic moved out of the app's runPublish
// into the GitHub adapter when publish became an intent-level port op — GitHub's
// blob→tree→commit model is this adapter's concern, so its tree logic is tested here.
describe('planRebaseOverlay', () => {
  const wipEntries: TreeEntry[] = [
    { path: 'content/pages/hello/index.md', type: 'blob', sha: 'HELLOBLOB' },
    { path: 'content/pages/hello/hero.webp', type: 'blob', sha: 'HEROBLOB' },
    { path: 'content/pages', type: 'tree', sha: 'TREESHA' },
  ];

  it('overlays a modified file with its WIP blob and deletes a removed file', () => {
    const changes: ChangedPath[] = [
      { path: 'content/pages/hello/index.md', status: 'modified' },
      { path: 'content/pages/removed/index.md', status: 'removed' },
    ];
    expect(planRebaseOverlay(changes, wipEntries)).toEqual([
      { path: 'content/pages/hello/index.md', sha: 'HELLOBLOB' },
      { path: 'content/pages/removed/index.md', sha: null },
    ]);
  });

  it('on a rename, writes the new path and deletes the old (previousPath)', () => {
    const changes: ChangedPath[] = [
      {
        path: 'content/pages/hello/index.md',
        status: 'renamed',
        previousPath: 'content/pages/hi/index.md',
      },
    ];
    expect(planRebaseOverlay(changes, wipEntries)).toEqual([
      { path: 'content/pages/hello/index.md', sha: 'HELLOBLOB' },
      { path: 'content/pages/hi/index.md', sha: null },
    ]);
  });

  it('ignores tree entries and a changed path absent from the WIP tree', () => {
    const changes: ChangedPath[] = [
      { path: 'content/pages/gone/index.md', status: 'modified' }, // no matching blob
    ];
    expect(planRebaseOverlay(changes, wipEntries)).toEqual([]);
  });

  it('returns an empty overlay for no changes', () => {
    expect(planRebaseOverlay([], wipEntries)).toEqual([]);
  });
});
