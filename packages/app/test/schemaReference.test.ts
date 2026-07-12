import { describe, expect, it } from 'vitest';
import { FIELD_KINDS } from '@timber/content';
import { FIELD_REFERENCE, SCHEMA_EXAMPLE } from '../src/advanced/schemaReference.js';
import { validateAdvancedFile } from '../src/advanced/validate.js';

describe('schema cheat-sheet reference', () => {
  it('documents every field kind exactly once, and no others', () => {
    const documented = FIELD_REFERENCE.map((f) => f.kind).sort();
    expect(documented).toEqual([...FIELD_KINDS].sort());
    expect(new Set(documented).size).toBe(documented.length); // no dupes
  });

  it('ships an example that is itself a valid schema', () => {
    expect(
      validateAdvancedFile({
        path: 'config/schemas/example.yml',
        kind: 'schema',
        content: SCHEMA_EXAMPLE,
      }).valid,
    ).toBe(true);
  });
});
