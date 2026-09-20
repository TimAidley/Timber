import { describe, expect, it } from 'vitest';
import { isStaleDraft } from '../src/state/draftFreshness.js';

/**
 * The base-SHA check that separates "not committed yet" from "the branch moved on"
 * (SPEC §5). It errs towards treating a draft as fresh: wrongly setting one aside
 * interrupts an author who has done nothing wrong, while the reverse is caught by the
 * caller's content comparison.
 */
describe('isStaleDraft', () => {
  it('is stale when the branch copy has changed since the draft was written', () => {
    expect(isStaleDraft({ baseSha: 'aaa' }, 'bbb')).toBe(true);
  });

  it('is fresh when the branch copy is untouched — ordinary unsaved work', () => {
    expect(isStaleDraft({ baseSha: 'aaa' }, 'aaa')).toBe(false);
  });

  it('is fresh for a draft with no branch copy to conflict with', () => {
    // A newly created object whose first commit hasn't landed: nothing to be stale against.
    expect(isStaleDraft({ baseSha: undefined }, 'aaa')).toBe(false);
    expect(isStaleDraft({ baseSha: 'aaa' }, undefined)).toBe(false);
  });

  it('is fresh for a draft written before base SHAs were recorded', () => {
    expect(isStaleDraft({}, 'aaa')).toBe(false);
  });
});
