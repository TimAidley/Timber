import type { Options as RemarkStringifyOptions } from 'remark-stringify';

/**
 * The **pinned canonical Markdown serialization** for Timber (SPEC §8).
 *
 * Milkdown is ProseMirror + remark: every editor state maps to a remark AST, and
 * the AST is serialized back to Markdown by remark-stringify. Byte-stable
 * round-trips are only possible if that serialization is *fixed* — otherwise the
 * editor would rewrite `*x*`→`_x_`, `* item`→`- item`, setext→atx, etc., churning
 * every reviewed diff and the git history the whole product rests on.
 *
 * So we pin one house style and normalize content to it: authored/saved Markdown
 * is always in this form, and every subsequent round-trip is a no-op. The choices
 * below match the widely-used Prettier Markdown conventions (least surprise for
 * anyone reading the raw files or diffing them on GitHub):
 *   - `-` bullets, `_emphasis_`, `**strong**`
 *   - fenced code blocks (```), never indented
 *   - `---` thematic breaks
 *   - one-space list-item indentation
 *
 * This module is framework-agnostic on purpose: the React editor component AND the
 * headless round-trip tests both import it, so the test proves the exact config
 * the editor ships with.
 */
export const remarkStringifyOptions: RemarkStringifyOptions = {
  bullet: '-',
  emphasis: '_',
  strong: '*',
  fence: '`',
  fences: true,
  rule: '-',
  ruleRepetition: 3,
  ruleSpaces: false,
  listItemIndent: 'one',
  incrementListMarker: true,
  resourceLink: false,
  tightDefinitions: true,
};
