import { describe, expect, it } from 'vitest';
import type { ChangedPath } from '@timber/github';
import { planBundleReset } from '../src/state/discard.js';

const DIR = 'content/events/fete';

describe('planBundleReset (revert a bundle to main, SPEC §5)', () => {
  it('self-moves modified/removed files to main and deletes WIP-only additions', () => {
    const changes: ChangedPath[] = [
      { path: `${DIR}/index.md`, status: 'modified' }, // edited on WIP → reset to main
      { path: `${DIR}/hero.webp`, status: 'removed' }, // deleted on WIP → re-add from main
      { path: `${DIR}/extra.webp`, status: 'added' }, // added on WIP → delete
    ];
    const mainSha = new Map([
      [`${DIR}/index.md`, 'MD_MAIN'],
      [`${DIR}/hero.webp`, 'HERO_MAIN'],
      // extra.webp is not on main
    ]);

    const plan = planBundleReset(changes, mainSha);

    expect(plan.moves).toEqual([
      { from: `${DIR}/index.md`, to: `${DIR}/index.md`, sha: 'MD_MAIN' },
      { from: `${DIR}/hero.webp`, to: `${DIR}/hero.webp`, sha: 'HERO_MAIN' },
    ]);
    expect(plan.deletions).toEqual([`${DIR}/extra.webp`]);
  });

  it('skips a non-added file that has no main blob (nothing to reset it to)', () => {
    const changes: ChangedPath[] = [{ path: `${DIR}/index.md`, status: 'modified' }];
    const plan = planBundleReset(changes, new Map());
    expect(plan.moves).toEqual([]);
    expect(plan.deletions).toEqual([]);
  });

  it('deletes every file for a brand-new bundle (all added)', () => {
    const changes: ChangedPath[] = [
      { path: `${DIR}/index.md`, status: 'added' },
      { path: `${DIR}/hero.webp`, status: 'added' },
    ];
    const plan = planBundleReset(changes, new Map());
    expect(plan.moves).toEqual([]);
    expect(plan.deletions).toEqual([`${DIR}/index.md`, `${DIR}/hero.webp`]);
  });
});
