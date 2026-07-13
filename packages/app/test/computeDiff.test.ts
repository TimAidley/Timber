import { describe, expect, it } from 'vitest';
import { computeLineDiff } from '../src/diff/computeDiff.js';

describe('computeLineDiff', () => {
  it('reports no add/remove for identical text', () => {
    const r = computeLineDiff('a\nb\nc\n', 'a\nb\nc\n');
    expect(r.added).toBe(0);
    expect(r.removed).toBe(0);
  });

  it('classifies a changed line as one del + one add', () => {
    const r = computeLineDiff('title: Old\nbody\n', 'title: New\nbody\n');
    expect(r.added).toBe(1);
    expect(r.removed).toBe(1);
    const del = r.rows.find((row) => row.type === 'del');
    const add = r.rows.find((row) => row.type === 'add');
    expect(del?.text).toBe('title: Old');
    expect(add?.text).toBe('title: New');
  });

  it('treats a null base (brand-new file) as all additions', () => {
    const r = computeLineDiff(null, 'one\ntwo\n');
    expect(r.removed).toBe(0);
    expect(r.added).toBe(2);
    expect(r.rows.map((row) => row.text)).toEqual(['one', 'two']);
  });

  it('counts added and removed lines independently', () => {
    const r = computeLineDiff('keep\ndrop1\ndrop2\n', 'keep\nnew1\n');
    expect(r.removed).toBe(2);
    expect(r.added).toBe(1);
  });

  it('folds long unchanged runs but keeps context around changes', () => {
    const base = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n') + '\n';
    const working = base.replace('line15', 'CHANGED');
    const r = computeLineDiff(base, working, { context: 3 });
    const fold = r.rows.filter((row) => row.type === 'fold');
    // The big gaps before and after the single change collapse into folds.
    expect(fold.length).toBeGreaterThanOrEqual(1);
    // Orientation is retained: the lines just around the change survive as context.
    const texts = r.rows.map((row) => row.text);
    expect(texts).toContain('line14');
    expect(texts).toContain('line16');
    // …but distant unchanged lines are hidden inside a fold, not rendered.
    expect(texts).not.toContain('line0');
  });

  it('does not fold a short unchanged gap between two changes', () => {
    const r = computeLineDiff('A\nx\nB\n', 'A2\nx\nB2\n', { context: 3 });
    expect(r.rows.some((row) => row.type === 'fold')).toBe(false);
  });
});
