import { describe, expect, it } from 'vitest';
import { roundTrip } from '../src/editor/roundTrip.js';

/**
 * The Phase 4a success gate (SPEC §8, CLAUDE.md): the Milkdown body editor must
 * round-trip Markdown byte-for-byte. Each fixture below is written in Timber's
 * pinned canonical form (see src/editor/milkdown.ts), so `roundTrip(md)` must
 * return it unchanged. A failure here means the editor would churn real content
 * diffs — the one thing this whole design refuses to allow.
 */
const CANONICAL: Record<string, string> = {
  headings: [
    '# Title',
    '',
    '## Section',
    '',
    'A paragraph with **strong** and _emphasis_ and `code`.',
    '',
  ].join('\n'),

  // A list with nested sublists serializes "loose" (blank lines between items) —
  // canonical form. Flat single-level lists (below) stay tight.
  'nested bullet list': [
    '- one',
    '',
    '- two',
    '',
    '  - two a',
    '',
    '  - two b',
    '',
    '- three',
    '',
  ].join('\n'),

  'ordered list': ['1. first', '2. second', '3. third', ''].join('\n'),

  'fenced code': [
    '```ts',
    'const x: number = 1;',
    'console.log(x);',
    '```',
    '',
  ].join('\n'),

  blockquote: ['> a quote', '>', '> second line', ''].join('\n'),

  links: ['See [the spec](./SPEC.md) for details.', ''].join('\n'),

  'thematic break': ['before', '', '---', '', 'after', ''].join('\n'),

  // Milkdown's pinned serializer emits compact (unpadded) GFM tables — that IS
  // the canonical form; content is normalized to it on save.
  'gfm table': [
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '| 3 | 4 |',
    '',
  ].join('\n'),

  // ...and emits task lists in "loose" form (blank line between items). Canonical.
  'gfm task list': ['- [ ] todo', '', '- [x] done', ''].join('\n'),

  'gfm strikethrough': ['This is ~~gone~~ now.', ''].join('\n'),
};

describe('Milkdown byte-stable round-trip (canonical form)', () => {
  for (const [name, markdown] of Object.entries(CANONICAL)) {
    it(`preserves ${name} byte-for-byte`, async () => {
      const out = await roundTrip(markdown);
      expect(out).toBe(markdown);
    });
  }
});

/**
 * The other half of the guarantee: non-canonical Markdown must *converge* to the
 * canonical form in a single pass and then never change again. This is what makes
 * "normalize on save, stable thereafter" true — the first save may rewrite house
 * style (e.g. `*x*`→`_x_`), but no later edit produces spurious churn.
 */
const NON_CANONICAL: Record<string, string> = {
  'emphasis/strong markers': 'Some *italic* and __bold__ text.\n',
  'star bullets': '* a\n* b\n* c\n',
  'setext heading': 'Title\n=====\n\nBody.\n',
  'padded table': '| a   | b   |\n| :-- | --- |\n| 1   | 2   |\n',
  'excess blank lines': '# H\n\n\n\nparagraph\n',
};

describe('Milkdown round-trip is idempotent (converges in one pass)', () => {
  for (const [name, markdown] of Object.entries(NON_CANONICAL)) {
    it(`stabilizes ${name}`, async () => {
      const once = await roundTrip(markdown);
      const twice = await roundTrip(once);
      expect(twice).toBe(once);
    });
  }
});
