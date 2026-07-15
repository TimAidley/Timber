import { describe, expect, it } from 'vitest';
import type { ContentObject } from '@timber/content';
import { mergeEditIntoObjects } from '../src/content/editState.js';

function obj(path: string, data: Record<string, unknown>, body = ''): ContentObject {
  return {
    type: 'posts',
    kind: 'collection',
    id: String(data.id ?? ''),
    slug: path.split('/').at(-2) ?? '',
    path,
    data,
    body,
    public: data.public === true,
  };
}

describe('mergeEditIntoObjects', () => {
  const a = obj('content/posts/a/index.md', { id: 'A', title: 'Old A' }, 'old body');
  const b = obj('content/posts/b/index.md', { id: 'B', title: 'B' });

  it('folds the edit buffer (data + body) into the matching object', () => {
    const next = mergeEditIntoObjects([a, b], a.path, { id: 'A', title: 'New A' }, 'new body');
    const merged = next.find((o) => o.path === a.path)!;
    expect(merged.data).toEqual({ id: 'A', title: 'New A' });
    expect(merged.body).toBe('new body');
    // Other objects are untouched (same reference).
    expect(next.find((o) => o.path === b.path)).toBe(b);
  });

  it('recomputes the derived public flag from the merged front matter', () => {
    const toPublic = mergeEditIntoObjects([a], a.path, { id: 'A', public: true }, '');
    expect(toPublic[0]!.public).toBe(true);
    // Removing the key (draft) flips the derived flag back.
    const backToDraft = mergeEditIntoObjects(toPublic, a.path, { id: 'A' }, '');
    expect(backToDraft[0]!.public).toBe(false);
  });

  it('returns the same array reference when the path is absent (e.g. just-deleted)', () => {
    const input = [a, b];
    const result = mergeEditIntoObjects(input, 'content/posts/gone/index.md', { id: 'X' }, '');
    expect(result).toBe(input);
  });

  it('does not mutate the input objects', () => {
    mergeEditIntoObjects([a], a.path, { id: 'A', title: 'Mutated?' }, 'x');
    expect(a.data).toEqual({ id: 'A', title: 'Old A' });
    expect(a.body).toBe('old body');
  });
});
