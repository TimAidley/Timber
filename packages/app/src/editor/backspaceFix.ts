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
 * Make the editor **always consume Backspace/Delete** so the browser never runs a
 * default action for them.
 *
 * ProseMirror deletes a single character through the browser's *native*
 * contentEditable behaviour and deliberately does **not** `preventDefault()` the
 * keydown. Most browsers are fine with that, but Vivaldi (and old Firefox) still map
 * a bare Backspace to "navigate Back" — so an un-prevented Backspace mid-edit throws
 * the user off the page and loses in-progress work. The fix: bind Backspace/Delete to
 * commands that perform the deletion in a transaction and return `true`, which makes
 * ProseMirror call `preventDefault()`. A trailing catch-all guarantees the key is
 * marked handled even at a document boundary where nothing is deleted.
 */

/** UTF-16 length of the last grapheme of a string (so we delete emoji/combining marks whole). */
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

/** Delete one grapheme before a collapsed text cursor; defers node boundaries to PM. */
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

/** Delete one grapheme after a collapsed text cursor; defers node boundaries to PM. */
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

// Consume the key even when nothing was deleted (e.g. Backspace at the very start of
// the document), so a bare Backspace can never fall through to browser navigation.
const consume: Command = () => true;

export const preventBackspaceNav = $prose(() =>
  keymap({
    Backspace: chainCommands(deleteSelection, deleteCharBackward, joinBackward, selectNodeBackward, consume),
    Delete: chainCommands(deleteSelection, deleteCharForward, joinForward, selectNodeForward, consume),
  }),
);
