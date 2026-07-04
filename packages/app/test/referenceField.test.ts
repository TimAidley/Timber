import { describe, expect, it } from 'vitest';
import { filterReferenceOptions } from '../src/forms/ReferenceField.js';
import type { ReferenceOption } from '../src/forms/widgets.js';

const options: ReferenceOption[] = [
  { id: 'p-jane', label: 'Jane Smith' },
  { id: 'p-john', label: 'John Doe' },
  { id: 'p-amy', label: 'Amy Wong' },
];

describe('filterReferenceOptions', () => {
  it('returns everything for an empty query', () => {
    expect(filterReferenceOptions(options, '')).toHaveLength(3);
    expect(filterReferenceOptions(options, '   ')).toHaveLength(3);
  });

  it('matches on title, case-insensitively', () => {
    expect(filterReferenceOptions(options, 'jo').map((o) => o.id)).toEqual(['p-john']);
    expect(filterReferenceOptions(options, 'WONG').map((o) => o.id)).toEqual(['p-amy']);
  });

  it('also matches on id (so a known id resolves)', () => {
    expect(filterReferenceOptions(options, 'p-jane').map((o) => o.id)).toEqual(['p-jane']);
  });

  it('returns [] when nothing matches', () => {
    expect(filterReferenceOptions(options, 'zzz')).toEqual([]);
  });

  it('caps results at the limit', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}`, label: `Item ${i}` }));
    expect(filterReferenceOptions(many, '', 50)).toHaveLength(50);
  });
});
