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

/**
 * Image embedding turns on `remark-directive` in the editor's remark stack, which
 * reinterprets `:` / `::` / `:::` document-wide. Left unchecked that would (a) crash
 * the parser on any directive without a node (`parserMatchError`), and (b) churn
 * ordinary colon-bearing prose. The `figureRemark` sanitiser neutralises every
 * non-`figure` directive back to the exact text it was typed as, so all of the below
 * must round-trip byte-for-byte. (The `:::figure` node itself is covered separately,
 * once its schema exists.)
 */
const DIRECTIVE_CONTAINMENT: Record<string, string> = {
  'bare body image': '![A tree at dawn](content/pages/home/images/tree.webp)\n',
  'emoji shortcode stays text': 'Nice work :tada: everyone.\n',
  'colon-word (TODO:fix)': 'TODO:fix this before shipping.\n',
  'branch-like token': 'Checkout git:main to see it.\n',
  'time of day': 'Standup is at 12:30 sharp.\n',
  'aspect ratio': 'Crop to 16:9 for the banner.\n',
  'stray leaf directive': '::note\n',
  'stray container directive': [':::warning', 'Not a figure.', ':::', ''].join('\n'),
  // The `:timber-logo` wordmark shortcode renders in the build/preview (generator),
  // but in the WYSIWYG it's a stray text directive like any other: neutralised back to
  // its exact source text, so it round-trips byte-for-byte and never crashes the editor.
  'timber-logo shortcode stays text': 'Built with :timber-logo today.\n',
};

describe('directive containment keeps colon prose byte-stable', () => {
  for (const [name, markdown] of Object.entries(DIRECTIVE_CONTAINMENT)) {
    it(`preserves ${name} byte-for-byte`, async () => {
      const out = await roundTrip(markdown);
      expect(out).toBe(markdown);
    });
    it(`stabilizes ${name} (idempotent)`, async () => {
      const once = await roundTrip(markdown);
      const twice = await roundTrip(once);
      expect(twice).toBe(once);
    });
  }
});

/**
 * The `:::figure` image node itself (SPEC §7). Canonical form: attributes double-
 * quoted, emitted only when non-default, in fixed order (`layout` then `size`); an
 * all-default figure with a caption drops the braces (`:::figure`); and the trivial
 * full-width/default-size/no-caption case is a **bare `![alt](src)`**, never a
 * directive. Each fixture is already canonical, so it must round-trip byte-for-byte.
 */
const FIGURE_CANONICAL: Record<string, string> = {
  'full-width with caption': [
    ':::figure',
    '![A tree at dawn](content/pages/home/images/tree.webp)',
    '',
    'Planted at _dawn_.',
    ':::',
    '',
  ].join('\n'),
  'wrap-right + non-default size + formatted caption': [
    ':::figure{layout="wrap-right" size="lg"}',
    '![A tree](content/x/images/t.webp)',
    '',
    'A caption with a [link](/gallery).',
    ':::',
    '',
  ].join('\n'),
  'single non-default attribute (size only)': [
    ':::figure{size="sm"}',
    '![A tree](content/x/images/t.webp)',
    '',
    'Small and centered later.',
    ':::',
    '',
  ].join('\n'),
  'centered, no caption': [
    ':::figure{layout="center"}',
    '![A tree](content/x/images/t.webp)',
    ':::',
    '',
  ].join('\n'),
};

describe('figure directive round-trips byte-for-byte', () => {
  for (const [name, markdown] of Object.entries(FIGURE_CANONICAL)) {
    it(`preserves ${name}`, async () => {
      const out = await roundTrip(markdown);
      expect(out).toBe(markdown);
    });
  }
});

/**
 * Non-canonical figures must converge: explicit default attributes are dropped, and a
 * default-everything figure with no caption collapses back to a bare image. This is
 * what keeps the editor from ever emitting a redundant directive.
 */
describe('figure directive normalizes to canonical form', () => {
  it('drops an explicit default layout and collapses to a bare image', async () => {
    const input = ':::figure{layout="full-width"}\n![A tree](img/t.webp)\n:::\n';
    expect(await roundTrip(input)).toBe('![A tree](img/t.webp)\n');
  });

  it('drops explicit default size, keeping the non-default layout', async () => {
    const input = ':::figure{layout="center" size="md"}\n![A tree](img/t.webp)\n:::\n';
    expect(await roundTrip(input)).toBe(
      ':::figure{layout="center"}\n![A tree](img/t.webp)\n:::\n',
    );
  });

  it('keeps a default-layout figure that has a caption (as :::figure)', async () => {
    const input = ':::figure\n![A tree](img/t.webp)\n\nHas a caption.\n:::\n';
    expect(await roundTrip(input)).toBe(input);
  });
});
