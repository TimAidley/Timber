import { describe, it, expect } from 'vitest';
import {
  parseFrontMatter,
  serializeDocument,
  formatDocument,
  isCanonicalDocument,
} from '../src/index.js';

/**
 * The on-disk `index.md` format (SPEC §4). `serializeDocument` is the exact inverse of
 * `parseFrontMatter`, and every producer of content must go through it: a file whose
 * bytes differ from what the editor would write shows as modified the instant the editor
 * loads it, and reverting restores the non-canonical bytes so the phantom diff comes
 * straight back. These tests pin the format and the properties CI relies on.
 */
describe('serializeDocument', () => {
  it('writes front matter, a blank separator line, then the body', () => {
    expect(serializeDocument({ title: 'Hello' }, 'Body **here**.\n')).toBe(
      '---\ntitle: Hello\n---\n\nBody **here**.\n',
    );
  });

  it('returns the body unchanged when there is no front matter', () => {
    expect(serializeDocument({}, 'Just prose.\n')).toBe('Just prose.\n');
  });

  it('still emits the separator for a body-less object', () => {
    // The settings singleton and any `hasBody: false` type land here. Omitting the
    // trailing blank line is precisely the drift that made 36 objects look dirty.
    expect(serializeDocument({ title: 'Settings' }, '')).toBe('---\ntitle: Settings\n---\n\n');
  });

  it('round-trips through parseFrontMatter', () => {
    const data = { title: 'Post', tags: ['a', 'b'], public: true };
    const body = 'Some *markdown*.\n';
    const parsed = parseFrontMatter(serializeDocument(data, body));
    expect(parsed.data).toEqual(data);
    expect(parsed.body).toBe(body);
  });
});

describe('formatDocument', () => {
  it('normalises a hand-authored file that omits the blank separator', () => {
    const raw = '---\ntitle: Home\n---\n';
    expect(formatDocument(raw)).toBe('---\ntitle: Home\n---\n\n');
  });

  it('normalises hand-quoted scalars without changing their parsed value', () => {
    // A quoted date is what a careful author writes to avoid YAML timestamp coercion.
    // The yaml package's core schema does not resolve timestamps, so dropping the quotes
    // is safe — but the value must still come back as a string, or validation breaks.
    const raw = "---\ndate: '2025-01-20T16:27:19-08:00'\n---\n\nBody\n";
    const formatted = formatDocument(raw);
    expect(formatted).toBe('---\ndate: 2025-01-20T16:27:19-08:00\n---\n\nBody\n');
    expect(parseFrontMatter(formatted).data.date).toBe('2025-01-20T16:27:19-08:00');
    expect(typeof parseFrontMatter(formatted).data.date).toBe('string');
  });

  it('is idempotent — safe to run in a hook or a CI check', () => {
    const raw = '---\ntitle:   Spaced\nkeywords: [a, b]\n---\nBody\n';
    const once = formatDocument(raw);
    expect(formatDocument(once)).toBe(once);
  });

  it('preserves the body exactly, including directives and trailing newlines', () => {
    const body = ':::figure{layout="wrap-right" size="md"}\n![Alt](x.jpg)\n:::\n\nText.\n';
    const formatted = formatDocument(`---\ntitle: T\n---\n\n${body}`);
    expect(parseFrontMatter(formatted).body).toBe(body);
  });

  it('leaves an already-canonical document untouched', () => {
    const canonical = '---\ntitle: Hello\n---\n\nBody.\n';
    expect(formatDocument(canonical)).toBe(canonical);
    expect(isCanonicalDocument(canonical)).toBe(true);
  });
});

describe('isCanonicalDocument', () => {
  it('flags the exact drift that makes an untouched object look modified', () => {
    expect(isCanonicalDocument('---\ntitle: Home\n---\n')).toBe(false);
    expect(isCanonicalDocument('---\ntitle: Home\n---\n\n')).toBe(true);
  });
});
