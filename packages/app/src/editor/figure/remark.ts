import { $remark } from '@milkdown/kit/utils';
import type { RemarkPluginRaw } from '@milkdown/kit/transformer';
import { directive } from 'micromark-extension-directive';
import { directiveFromMarkdown, directiveToMarkdown } from 'mdast-util-directive';
import { SKIP, visit } from 'unist-util-visit';

/**
 * The container-directive name that backs the image `figure` node. Every OTHER
 * directive (text `:x`, leaf `::x`, or a container `:::y` with a different name)
 * is "stray" and gets neutralised back to plain text — see {@link sanitizeStrayDirectives}.
 */
export const FIGURE_DIRECTIVE = 'figure';

/** The minimal mdast shape the sanitiser inspects (avoids a hard `@types/mdast` dep). */
interface MdNode {
  type: string;
  name?: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** The slice of a unified processor's `data()` we mutate to register the extensions. */
interface ProcessorData {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
  toMarkdownExtensions?: unknown[];
}

/**
 * Recover a stray directive's *original source text* so it round-trips byte-for-byte.
 * micromark always records byte offsets; the `:name` fallback is defensive only.
 */
function rawSource(node: MdNode, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start != null && end != null) return source.slice(start, end);
  return node.name ? `:${node.name}` : '';
}

/**
 * A remark transform that turns every directive EXCEPT `:::figure` back into the
 * plain text it was typed as. Two reasons this is mandatory, not cosmetic:
 *
 *  1. **No crash.** Milkdown's parser throws `parserMatchError` on any mdast node
 *     with no node-parser (transformer `stack-element`), so an unmatched `:tada:`
 *     or stray `:::note` would fail the whole document load. Only `figure` has a
 *     parser; everything else must be gone before the mdast→prose walk.
 *  2. **Byte-stability.** Enabling directive parsing reinterprets `:` / `::` / `:::`
 *     document-wide (`TODO:fix`, `9:16`, `:tada:`…). Reconstructing each from its
 *     source offsets and re-emitting as text keeps ordinary prose diff-clean.
 *
 * Runs during `remark.runSync(...)` (see @milkdown/transformer parser), which is
 * why a transform — not a parse-only extension — is the right hook.
 */
function sanitizeStrayDirectives(tree: MdNode, file: { toString(): string }): void {
  const source = file.toString();
  visit(tree as never, (raw: unknown, index: number | undefined, rawParent: unknown) => {
    const node = raw as MdNode;
    const parent = rawParent as MdNode | undefined;
    if (!parent?.children || index == null) return;
    const stray =
      node.type === 'textDirective' ||
      node.type === 'leafDirective' ||
      (node.type === 'containerDirective' && node.name !== FIGURE_DIRECTIVE);
    if (!stray) return;
    const text = rawSource(node, source);
    parent.children[index] =
      node.type === 'textDirective'
        ? { type: 'text', value: text }
        : { type: 'paragraph', children: [{ type: 'text', value: text }] };
    // Don't descend into the replacement (it's inert text now).
    return [SKIP, index];
  });
}

/**
 * The unified plugin, registered on Milkdown's shared remark processor. It wires
 * directive **parsing** (micromark + from-markdown) plus a **serialisation** handler
 * for the figure container — reusing `mdast-util-directive`'s well-tested stringify
 * handlers (correct attribute quoting = our canonical form) but deliberately DROPPING
 * its `unsafe` patterns.
 *
 * Those `unsafe` patterns escape colons in phrasing (`TODO:fix` → `TODO\:fix`) to stop
 * text being re-read as a directive. We don't want that escaping — it would churn
 * ordinary prose — and we don't need it: {@link sanitizeStrayDirectives} guarantees the
 * only directive reaching the serialiser is a well-formed `:::figure`, so nothing else
 * can be misparsed on the next round-trip.
 */
function remarkFigureDirective(this: { data(): ProcessorData }): (
  tree: MdNode,
  file: { toString(): string },
) => void {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(directive());
  (data.fromMarkdownExtensions ??= []).push(directiveFromMarkdown());
  (data.toMarkdownExtensions ??= []).push({ handlers: directiveToMarkdown().handlers });
  return sanitizeStrayDirectives;
}

/**
 * Milkdown plugin bundle: directive parse/serialise + the stray-directive sanitiser.
 * Used by the editor AND the headless round-trip harness (it affects the transform
 * pipeline, not the view), so both prove the exact same behaviour.
 */
export const figureRemark = $remark(
  'figureDirective',
  // The plugin uses a minimal local `this`/mdast typing (no hard `@types/mdast`
  // dep); bridge it to unified's exact plugin type at the boundary.
  () => remarkFigureDirective as unknown as RemarkPluginRaw<undefined>,
);
