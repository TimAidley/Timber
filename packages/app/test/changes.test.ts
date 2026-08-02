import { describe, expect, it } from 'vitest';
import { objectChangeState, siteFileChanges, summarizeChanges } from '../src/state/changes.js';

const A = 'content/events/a/index.md';
const B = 'content/events/b/index.md';
const C = 'content/events/c/index.md';

describe('objectChangeState', () => {
  it('is "editing" when the object has local-only edits', () => {
    expect(objectChangeState(A, new Set([A]), new Set())).toBe('editing');
  });

  it('is "saved" when committed to WIP but not published', () => {
    expect(objectChangeState(A, new Set(), new Set([A]))).toBe('saved');
  });

  it('prefers "editing" over "saved" (the furthest-back state wins)', () => {
    expect(objectChangeState(A, new Set([A]), new Set([A]))).toBe('editing');
  });

  it('is "saved" when a colocated asset changed even if the index.md did not', () => {
    expect(objectChangeState(A, new Set(), new Set(['content/events/a/images/hero.webp']))).toBe('saved');
  });

  it('is "clean" when nothing pending', () => {
    expect(objectChangeState(A, new Set([B]), new Set([C]))).toBe('clean');
  });

  it('is "deleting" when marked for deletion, overriding editing/saved', () => {
    expect(objectChangeState(A, new Set([A]), new Set([A]), new Set([A]))).toBe('deleting');
  });
});

describe('summarizeChanges', () => {
  it('tallies editing and saved counts, not double-counting a both-state object', () => {
    // A is editing (and also in the saved set); B is saved; C is clean.
    const counts = summarizeChanges([A, B, C], new Set([A]), new Set([A, B]));
    expect(counts).toEqual({ editing: 1, saved: 1, deleting: 0 });
  });

  it('counts a pending deletion under "deleting", not editing/saved', () => {
    // A is marked deleting (and would otherwise be saved); B is saved; C is clean.
    const counts = summarizeChanges([A, B, C], new Set(), new Set([A, B]), new Set([A]));
    expect(counts).toEqual({ editing: 0, saved: 1, deleting: 1 });
  });

  it('returns zeros when everything is clean', () => {
    expect(summarizeChanges([A, B], new Set(), new Set())).toEqual({ editing: 0, saved: 0, deleting: 0 });
  });

  // A template/schema/config edit from the advanced area is committed to the same WIP
  // branch and ships in the same publish, but belongs to no object. Counting objects alone
  // left it invisible — and since the Publish button is gated on these counts, unpublishable.
  it('counts a changed site file that belongs to no object', () => {
    const counts = summarizeChanges(
      [A, B],
      new Set(),
      new Set(['themes/acme/templates/footer.liquid']),
    );
    expect(counts).toEqual({ editing: 0, saved: 1, deleting: 0 });
  });

  it('counts site files alongside changed objects', () => {
    const counts = summarizeChanges(
      [A, B, C],
      new Set([A]),
      new Set([A, B, 'config/schemas/pages.yml', 'themes/acme/assets/theme.css']),
    );
    expect(counts).toEqual({ editing: 1, saved: 3, deleting: 0 });
  });

  it('does not double-count a colocated asset, which belongs to its object', () => {
    const counts = summarizeChanges(
      [A, B],
      new Set(),
      new Set(['content/events/a/images/hero.webp']),
    );
    expect(counts).toEqual({ editing: 0, saved: 1, deleting: 0 });
  });

  // An advanced-area edit is unsaved for the ~5s until the coalesced commit lands, and
  // during that window the header read "No unpublished changes" — nothing at all, where
  // a page edit badges immediately.
  it('counts a site file with local-only edits under "editing"', () => {
    const counts = summarizeChanges([A, B], new Set(['themes/acme/assets/theme.css']), new Set());
    expect(counts).toEqual({ editing: 1, saved: 0, deleting: 0 });
  });

  it('counts a site file that is both editing and saved once, as editing', () => {
    const css = 'themes/acme/assets/theme.css';
    const counts = summarizeChanges([A, B], new Set([css]), new Set([css]));
    expect(counts).toEqual({ editing: 1, saved: 0, deleting: 0 });
  });
});

describe('siteFileChanges', () => {
  it('states each changed non-object path, editing winning over saved', () => {
    const css = 'themes/acme/assets/theme.css';
    const yml = 'config/schemas/pages.yml';
    expect(siteFileChanges([A, B], new Set([css]), new Set([css, yml]))).toEqual([
      { path: css, state: 'editing' },
      { path: yml, state: 'saved' },
    ]);
  });

  it('excludes objects and their bundles (those belong to the object)', () => {
    expect(
      siteFileChanges([A, B], new Set([A]), new Set(['content/events/a/images/hero.webp'])),
    ).toEqual([]);
  });
});
