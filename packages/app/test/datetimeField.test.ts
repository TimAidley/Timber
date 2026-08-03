import { describe, expect, it } from 'vitest';
import {
  Validator,
  type ContentModel,
  type ContentObject,
  type ContentTypeSchema,
} from '@timber/content';
import {
  datetimeFromInput,
  datetimeToInput,
  isZonelessDatetime,
} from '../src/forms/datetime.js';

/**
 * A one-field `posts` type, validated through the same {@link Validator} the editor
 * gates "Publish" on — so these assertions are about the real draft/public verdict, not
 * a restatement of the widget's own regex.
 */
const schema: ContentTypeSchema = {
  name: 'posts',
  kind: 'collection',
  hasBody: true,
  fields: { date: { type: 'datetime', label: 'Publish date', required: true } },
};

const model: ContentModel = {
  schemas: new Map([['posts', schema]]),
  objects: [],
  byId: new Map(),
  byTranslation: new Map(),
  errors: [],
};

/** Would a post carrying this `date` be publishable, or pinned to "Invalid — draft only"? */
function publishable(date: unknown): boolean {
  const object: ContentObject = {
    type: 'posts',
    kind: 'collection',
    slug: 'hello',
    path: 'content/posts/hello/index.md',
    data: { title: 'Hello', date },
    body: '',
    public: false,
  };
  return new Validator(model.schemas).validateObject(object, model).valid;
}

describe('datetimeFromInput', () => {
  it('makes what the native picker emits publishable', () => {
    // The bug: `<input type="datetime-local">` yields no seconds and no zone, so a post
    // with a publish date typed into the form could never leave draft.
    expect(publishable('2026-08-03T14:30')).toBe(false);

    const stored = datetimeFromInput('2026-08-03T14:30');
    expect(stored).toBe('2026-08-03T14:30:00Z');
    expect(publishable(stored)).toBe(true);
  });

  it('keeps the typed wall clock rather than shifting it into the browser zone', () => {
    expect(datetimeFromInput('2026-08-03T14:30')).toContain('T14:30');
  });

  it('keeps seconds when the picker offers them', () => {
    expect(datetimeFromInput('2026-08-03T14:30:45')).toBe('2026-08-03T14:30:45Z');
  });

  it('clears the field when emptied', () => {
    expect(datetimeFromInput('')).toBeUndefined();
    expect(datetimeFromInput('   ')).toBeUndefined();
  });

  it('passes an unrecognised value through for the validator to report', () => {
    expect(datetimeFromInput('next tuesday')).toBe('next tuesday');
  });

  it('leaves a value that already carries a zone alone', () => {
    expect(datetimeFromInput('2026-08-03T14:30:00+01:00')).toBe('2026-08-03T14:30:00+01:00');
  });
});

describe('datetimeToInput', () => {
  it('renders a stored value back into the picker', () => {
    // The other half of the bug: the control shows an empty box for a full RFC 3339
    // value, so a good date looked lost the moment the page was reopened.
    expect(datetimeToInput('2026-08-03T14:30:00Z')).toBe('2026-08-03T14:30');
    expect(datetimeToInput('2026-08-03T14:30:00.000Z')).toBe('2026-08-03T14:30');
  });

  it('round-trips through the picker without drift', () => {
    const stored = '2026-08-03T14:30:00Z';
    expect(datetimeFromInput(datetimeToInput(stored))).toBe(stored);
  });

  it('keeps non-zero seconds visible', () => {
    expect(datetimeToInput('2026-08-03T14:30:45Z')).toBe('2026-08-03T14:30:45');
  });

  it('shows an offset value in UTC, so the box matches what is stored', () => {
    expect(datetimeToInput('2026-08-03T14:30:00+01:00')).toBe('2026-08-03T13:30');
  });

  it('shows the zone-less values written before the fix', () => {
    expect(datetimeToInput('2026-08-03T14:30')).toBe('2026-08-03T14:30');
  });

  it('empties the picker for anything unreadable', () => {
    expect(datetimeToInput('next tuesday')).toBe('');
    expect(datetimeToInput(undefined)).toBe('');
    expect(datetimeToInput(1_754_231_400_000)).toBe('');
  });
});

describe('isZonelessDatetime', () => {
  it('spots the shape the old widget wrote', () => {
    expect(isZonelessDatetime('2026-08-03T14:30')).toBe(true);
    expect(isZonelessDatetime('2026-08-03T14:30:45')).toBe(true);
  });

  it('leaves valid and unreadable values alone', () => {
    expect(isZonelessDatetime('2026-08-03T14:30:00Z')).toBe(false);
    expect(isZonelessDatetime('2026-08-03T14:30:00+01:00')).toBe(false);
    expect(isZonelessDatetime('next tuesday')).toBe(false);
    expect(isZonelessDatetime(undefined)).toBe(false);
  });

  it('upgrades an already-committed bad value to a publishable one, same wall clock', () => {
    const upgraded = datetimeFromInput(datetimeToInput('2026-08-03T14:30'));
    expect(upgraded).toBe('2026-08-03T14:30:00Z');
    expect(publishable(upgraded)).toBe(true);
  });
});
