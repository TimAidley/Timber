import { $prose } from '@milkdown/kit/utils';
import { keymap } from '@milkdown/kit/prose/keymap';
import {
  chainCommands,
  deleteSelection,
  joinBackward,
  selectNodeBackward,
  joinForward,
  selectNodeForward,
} from '@milkdown/kit/prose/commands';
import { TextSelection, type Command } from '@milkdown/kit/prose/state';

/**
 * Make the editor **handle a plain in-text Backspace/Delete itself** — deleting the
 * character in a transaction and returning `true`, so ProseMirror calls
 * `preventDefault()`.
 *
 * Why: ProseMirror normally deletes a single character through the browser's *native*
 * contentEditable behaviour and does NOT `preventDefault()` the keydown. Most browsers
 * are fine, but Vivaldi (and old Firefox) map a bare Backspace to "navigate Back", so
 * an un-prevented Backspace mid-edit throws the user off the page. Handling the common
 * case here stops that for normal typing/deleting.
 *
 * We deliberately do NOT try to handle every position (block joins, node boundaries):
 * those fall through to ProseMirror's own `joinBackward`/`selectNodeBackward` (which
 * DO preventDefault when they act) or, failing that, to native behaviour. An earlier
 * "always consume" catch-all created dead keys at block boundaries. The rare
 * back-navigation that can still leak through those boundary cases is caught by the
 * history guard ({@link useBackNavigationGuard}) instead of by mangling editing.
 */

/** UTF-16 length of the last grapheme of a string (delete emoji/combining marks whole). */
function lastGraphemeLength(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let len = 0;
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      len = segment.length;
    }
    return len || 1;
  }
  const points = Array.from(text);
  return (points[points.length - 1] ?? ' ').length || 1;
}

/** UTF-16 length of the first grapheme of a string. */
function firstGraphemeLength(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      return segment.length || 1;
    }
    return 1;
  }
  return (Array.from(text)[0] ?? ' ').length || 1;
}

/** Delete one grapheme before a collapsed text cursor; defers everything else to PM. */
const deleteCharBackward: Command = (state, dispatch, view) => {
  if (view?.composing) return false; // never interrupt IME composition
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.$cursor) return false;
  const before = sel.$cursor.nodeBefore;
  if (!before || !before.isText || !before.text) return false;
  const to = sel.$cursor.pos;
  const from = to - lastGraphemeLength(before.text);
  if (dispatch) dispatch(state.tr.delete(from, to).scrollIntoView());
  return true;
};

/** Delete one grapheme after a collapsed text cursor; defers everything else to PM. */
const deleteCharForward: Command = (state, dispatch, view) => {
  if (view?.composing) return false;
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.$cursor) return false;
  const after = sel.$cursor.nodeAfter;
  if (!after || !after.isText || !after.text) return false;
  const from = sel.$cursor.pos;
  const to = from + firstGraphemeLength(after.text);
  if (dispatch) dispatch(state.tr.delete(from, to).scrollIntoView());
  return true;
};

export const preventBackspaceNav = $prose(() =>
  keymap({
    Backspace: chainCommands(deleteSelection, deleteCharBackward, joinBackward, selectNodeBackward),
    Delete: chainCommands(deleteSelection, deleteCharForward, joinForward, selectNodeForward),
  }),
);
