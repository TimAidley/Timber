import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from '@timber/generator';
import { roundTrip } from '../src/editor/roundTrip.js';

/**
 * SPEC §8: "Only the body round-trips through the editor; front matter stays in
 * the structured schema form." This shrinks the round-trip surface to just the
 * Markdown body — the structured data never passes through Milkdown, so it can't
 * be reformatted by it. Here we prove the split: `parseFrontMatter` (reused from
 * the generator, not reimplemented) cleanly separates data from body, and only
 * the body goes through the editor round-trip.
 */
describe('front-matter boundary', () => {
  it('parses data out untouched and round-trips only the body', async () => {
    const body = '# Hello\n\nWorld with _emphasis_ and a [link](./x.md).\n';
    const doc = ['---', 'title: Hi there', 'id: OBJ-1', 'public: true', '---', '', body].join('\n');

    const { data, body: parsedBody } = parseFrontMatter(doc);

    // Structured data is handed to the form as-is; the editor never sees it.
    expect(data).toEqual({ title: 'Hi there', id: 'OBJ-1', public: true });

    // The body is separated cleanly and is byte-stable through the editor.
    expect(parsedBody).toBe(body);
    expect(await roundTrip(parsedBody)).toBe(body);
  });
});
