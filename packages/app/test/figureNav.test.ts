import { describe, it, expect } from 'vitest';
import { Editor, rootCtx, parserCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { figureRemark } from '../src/editor/figure/remark.js';
import { figureSchema } from '../src/editor/figure/schema.js';
import { exitFigureBackward } from '../src/editor/figure/keymap.js';

/**
 * The caret couldn't leave a figure caption going backwards (ArrowUp/ArrowLeft) because
 * the image sits above the caption as non-editable NodeView chrome and traps the
 * browser's native motion. `exitFigureBackward` handles that at the document-model level,
 * which is what these tests exercise (synthetic arrow keys can't be tested in a headless
 * browser — ProseMirror only moves the selection for trusted key events).
 */
async function docFrom(markdown: string): Promise<ProseNode> {
  const editor = await Editor.make()
    .config((ctx) => ctx.set(rootCtx, document.createElement('div')))
    .use(commonmark)
    .use(gfm)
    .use(figureRemark)
    .use(figureSchema)
    .create();
  try {
    return editor.action((ctx) => {
      const doc = ctx.get(parserCtx)(markdown);
      if (!doc) throw new Error('parser returned no document');
      return doc;
    });
  } finally {
    await editor.destroy();
  }
}

function figurePosIn(doc: ProseNode): number {
  let pos = -1;
  doc.descendants((node, at) => {
    if (node.type.name === 'figure') pos = at;
  });
  return pos;
}

const WITH_FIGURE = 'before\n\n:::figure\n![a](x.webp)\n\ncaption\n:::\n';

describe('figure caption navigation', () => {
  it('steps the caret from caption start out to the block above', async () => {
    const doc = await docFrom(WITH_FIGURE);
    const figurePos = figurePosIn(doc);
    expect(figurePos).toBeGreaterThan(0);

    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, figurePos + 1), // start of the caption
    });
    expect(state.selection.$from.parent.type.name).toBe('figure');

    let next = state;
    const handled = exitFigureBackward(state, (tr) => {
      next = state.apply(tr);
    });

    expect(handled).toBe(true);
    expect(next.selection.from).toBeLessThan(figurePos);
    expect(next.selection.$from.parent.textContent).toBe('before');
  });

  it('is a no-op when the caret is not at the caption start', async () => {
    const doc = await docFrom(WITH_FIGURE);
    const figurePos = figurePosIn(doc);

    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, figurePos + 1 + 3), // mid-caption
    });
    expect(exitFigureBackward(state, () => {})).toBe(false);
  });

  it('is a no-op for a plain paragraph selection', async () => {
    const doc = await docFrom('just a paragraph\n');
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
    expect(exitFigureBackward(state, () => {})).toBe(false);
  });
});
