import { Editor, rootCtx, parserCtx, serializerCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { remarkStringifyOptions } from './milkdown.js';
import { figureRemark } from './figure/remark.js';

/**
 * Parse Markdown into Milkdown's document model and serialize it straight back,
 * using the exact parser + serializer the editor ships with. This is the headless
 * heart of the byte-stable round-trip guarantee (SPEC §8): if
 * `roundTrip(md) === md` for canonical-form input, the WYSIWYG editor cannot
 * silently rewrite the source.
 *
 * It goes through `parserCtx`/`serializerCtx` directly rather than mounting the
 * ProseMirror view and reading it back, so the proof is about the transform
 * pipeline, not view/render timing — but it still needs the plugins that *build*
 * that pipeline (commonmark/gfm) to have run, which is why a (throwaway) editor is
 * created. `rootCtx` gets a detached element; nothing is ever displayed.
 */
export async function roundTrip(markdown: string): Promise<string> {
  const root = document.createElement('div');

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(remarkStringifyOptionsCtx, remarkStringifyOptions);
    })
    .use(commonmark)
    .use(gfm)
    .use(figureRemark)
    .create();

  try {
    return editor.action((ctx) => {
      const parser = ctx.get(parserCtx);
      const serializer = ctx.get(serializerCtx);
      const doc = parser(markdown);
      if (!doc) {
        throw new Error('Milkdown parser returned no document');
      }
      return serializer(doc);
    });
  } finally {
    await editor.destroy();
  }
}
