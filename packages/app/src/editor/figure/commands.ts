import { $command } from '@milkdown/kit/utils';
import { DEFAULT_LAYOUT, DEFAULT_SIZE, figureSchema, normalizeLayout, normalizeSize } from './schema.js';

export interface InsertFigurePayload {
  src: string;
  alt?: string;
  layout?: string;
  size?: string;
}

/**
 * Insert a figure node at the current selection (SPEC §7). Mirrors the built-in
 * `insertImageCommand`: creates the node from the payload and replaces the selection.
 * A fresh figure has an empty caption, so at default layout/size it serialises to a
 * bare `![alt](src)` until the author adds a caption or changes the layout.
 */
export const insertFigureCommand = $command(
  'InsertFigure',
  (ctx) =>
    (payload?: InsertFigurePayload) =>
    (state, dispatch) => {
      if (!dispatch) return true;
      const node = figureSchema.type(ctx).create({
        src: payload?.src ?? '',
        alt: payload?.alt ?? '',
        layout: normalizeLayout(payload?.layout ?? DEFAULT_LAYOUT),
        size: normalizeSize(payload?.size ?? DEFAULT_SIZE),
      });
      if (!node) return true;
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
      return true;
    },
);
