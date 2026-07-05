import { describe, expect, it } from 'vitest';
import { objectChangeState, summarizeChanges } from '../src/state/changes.js';

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
});

describe('summarizeChanges', () => {
  it('tallies editing and saved counts, not double-counting a both-state object', () => {
    // A is editing (and also in the saved set); B is saved; C is clean.
    const counts = summarizeChanges([A, B, C], new Set([A]), new Set([A, B]));
    expect(counts).toEqual({ editing: 1, saved: 1 });
  });

  it('returns zeros when everything is clean', () => {
    expect(summarizeChanges([A, B], new Set(), new Set())).toEqual({ editing: 0, saved: 0 });
  });
});
