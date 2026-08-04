import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { SerializerState } from '@milkdown/kit/transformer';
import { bulletListSchema } from '@milkdown/kit/preset/commonmark';
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm';

/**
 * Serialize lists **tight unless the author made them loose** — a fix for a
 * Milkdown 7.x preset bug that rewrote every bullet list to loose form.
 *
 * Background: Markdown draws a real distinction between a *tight* list
 * (`- a\n- b`, renders `<li>a</li>`) and a *loose* one (blank lines between
 * items, renders `<li><p>a</p></li>` — visibly more spaced). remark models it
 * as a boolean `spread` on the `list`/`listItem` mdast nodes, and
 * mdast-util-to-markdown honours it **only when it is a boolean**: its join
 * rule checks `typeof parent.spread === 'boolean'` and, when that fails, falls
 * through to the default of a blank line between blocks.
 *
 * Milkdown's `bullet_list`/`list_item` schemas store `spread` as the *string*
 * `"true"`/`"false"` on parse but pass it through unconverted on serialize, so
 * every bullet list hits that default branch and comes back loose: a tight
 * `- a\n- b\n- c` was rewritten to `- a\n\n- b\n\n- c` on the first save,
 * churning the file (against SPEC §8 byte-stability) and permanently switching
 * the published list to the spaced `<li><p>` rendering. (`ordered_list` is
 * unaffected upstream — its serializer already coerces with `=== "true"`.)
 *
 * These two plugins extend the presets' schemas and replace only the
 * `toMarkdown` runners, coercing `spread` to a real boolean. Both string and
 * boolean forms are honoured because the attr's type varies by path: Markdown
 * parse stores strings, DOM paste and attr defaults produce booleans.
 * Authored form is thus *preserved* — tight stays tight, deliberately loose
 * stays loose — and the list-item `spread` default flips to `false` so content
 * created in the editor serializes tight, the canonical form. (A tight item
 * can never corrupt content: mdast-util-to-markdown always keeps the required
 * blank line between two paragraphs regardless of `spread`.)
 *
 * They must be `.use`d **after** `commonmark`/`gfm`: node registration is
 * last-wins per id, and `list_item` is extended from the GFM task-list schema
 * (itself an extension of commonmark's) so task-item handling is kept.
 */

/** `spread` as stored on list nodes: string from Markdown parse, boolean from DOM/defaults. */
function isSpread(value: unknown): boolean {
  return value === true || value === 'true';
}

export const bulletListSpreadFix = bulletListSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    toMarkdown: {
      ...base.toMarkdown,
      runner: (state: SerializerState, node: ProseNode) => {
        state
          .openNode('list', undefined, { ordered: false, spread: isSpread(node.attrs.spread) })
          .next(node.content)
          .closeNode();
      },
    },
  };
});

export const listItemSpreadFix = extendListItemSchemaForTask.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    attrs: {
      ...base.attrs,
      spread: { ...base.attrs?.spread, default: false },
    },
    toMarkdown: {
      ...base.toMarkdown,
      runner: (state: SerializerState, node: ProseNode) => {
        const spread = isSpread(node.attrs.spread);
        if (node.attrs.checked == null) {
          state.openNode('listItem', undefined, { spread });
        } else {
          // GFM task item: keep the extended schema's full payload, only fixing `spread`.
          state.openNode('listItem', undefined, {
            label: node.attrs.label,
            listType: node.attrs.listType,
            spread,
            checked: node.attrs.checked,
          });
        }
        state.next(node.content).closeNode();
      },
    },
  };
});
