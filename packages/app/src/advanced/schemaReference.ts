import type { FieldKind } from '@timber/content';

/**
 * The data behind the schema YAML **cheat sheet** (SPEC §8) shown under the advanced
 * editor. Kept as plain data (not JSX) so a test can assert {@link FIELD_REFERENCE}
 * stays in lock-step with the content package's `FIELD_KINDS` — a new field kind that
 * isn't documented here fails that test.
 */

/** Top-level keys a `config/schemas/<name>.yml` file understands. */
export interface SchemaKeyDoc {
  key: string;
  summary: string;
}

export const SCHEMA_KEYS: readonly SchemaKeyDoc[] = [
  { key: 'kind', summary: 'collection (many objects) or singleton (exactly one)' },
  { key: 'hasBody', summary: 'true to give objects a Markdown body (default: true)' },
  { key: 'page', summary: 'true if objects render as their own page (default: true)' },
  {
    key: 'urlPattern',
    summary: 'URL override, e.g. /{slug}/ (default: /{type}/{slug}/)',
  },
  { key: 'fields', summary: 'the form fields — each has a type, see below' },
];

/** One field kind's row in the cheat sheet: what it is + which extra keys it takes. */
export interface FieldDoc {
  kind: FieldKind;
  summary: string;
  /** Extra per-field keys beyond `type` (all fields also accept required + label). */
  options: readonly string[];
}

const COMMON = ['required', 'label'] as const;

export const FIELD_REFERENCE: readonly FieldDoc[] = [
  {
    kind: 'text',
    summary: 'Single-line text',
    options: [...COMMON, 'maxLength', 'pattern'],
  },
  {
    kind: 'multiline',
    summary: 'Multi-line plain text',
    options: [...COMMON, 'maxLength', 'pattern'],
  },
  { kind: 'number', summary: 'A number', options: [...COMMON, 'min', 'max'] },
  { kind: 'boolean', summary: 'A true / false toggle', options: ['label'] },
  { kind: 'date', summary: 'Calendar date (YYYY-MM-DD)', options: [...COMMON] },
  { kind: 'datetime', summary: 'Date and time (ISO-8601)', options: [...COMMON] },
  {
    kind: 'enum',
    summary: 'Single choice from a list',
    options: [...COMMON, 'options (required)'],
  },
  { kind: 'tags', summary: 'A list of free-text tags', options: ['label'] },
  { kind: 'image', summary: 'An uploaded image (colocated asset)', options: [...COMMON] },
  {
    kind: 'reference',
    summary: 'A link to another object (stores its id)',
    options: [...COMMON, 'referenceType'],
  },
  {
    kind: 'video',
    summary: 'External video URL (allow-listed provider)',
    options: [...COMMON],
  },
];

/** A minimal, valid schema shown as a worked example in the cheat sheet. */
export const SCHEMA_EXAMPLE = `kind: collection
hasBody: true
fields:
  title:
    type: text
    required: true
  date:
    type: date
  venue:
    type: reference
    referenceType: places`;
