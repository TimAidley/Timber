import { $prose } from '@milkdown/kit/utils';
import { keymap } from '@milkdown/kit/prose/keymap';
import { Selection, type Command } from '@milkdown/kit/prose/state';
import { GapCursor } from '@milkdown/kit/prose/gapcursor';
import { FIGURE_DIRECTIVE } from './remark.js';

/**
 * Step the caret out of the *front* of a figure's caption to the block above it.
 *
 * The caption is the figure node's editable content, but the image + control bar sit
 * above it as non-editable NodeView chrome. The browser's native back-arrow motion
 * gets trapped in that non-editable region, so ArrowLeft/ArrowUp at the caption start
 * would otherwise do nothing. This moves the selection to the nearest text position
 * before the figure (or a gap cursor, when the figure is the first block).
 *
 * Returns `false` in every other position so normal arrow behaviour is untouched.
 */
export const exitFigureBackward: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  if ($from.parent.type.name !== FIGURE_DIRECTIVE || $from.parentOffset !== 0) return false;

  const $before = state.doc.resolve($from.before($from.depth));
  const target = Selection.findFrom($before, -1) ?? new GapCursor($before);
  if (dispatch) dispatch(state.tr.setSelection(target).scrollIntoView());
  return true;
};

/** Keymap plugin binding the caption-exit to the back-arrow keys. */
export const figureKeymap = $prose(() =>
  keymap({
    ArrowLeft: exitFigureBackward,
    ArrowUp: exitFigureBackward,
  }),
);
