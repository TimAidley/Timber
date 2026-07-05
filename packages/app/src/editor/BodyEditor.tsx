import { useCallback, useState } from 'react';
import { Editor, rootCtx, defaultValueCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { remarkStringifyOptions } from './milkdown.js';
import { preventBackspaceNav } from './backspaceFix.js';

interface BodyEditorProps {
  /** Current Markdown body (canonical form). */
  value: string;
  /** Called with the new Markdown whenever the body changes. */
  onChange: (markdown: string) => void;
}

/**
 * The Milkdown WYSIWYG instance. It seeds from `value` once (Milkdown's React
 * binding is uncontrolled — see the raw/source toggle note in {@link BodyEditor}),
 * pins Timber's canonical serialization (`remarkStringifyOptionsCtx`, the SAME
 * config the round-trip tests prove), and reports edits via the listener plugin's
 * `markdownUpdated`.
 */
function Wysiwyg({ value, onChange }: BodyEditorProps): React.JSX.Element {
  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, value);
          ctx.set(remarkStringifyOptionsCtx, remarkStringifyOptions);
          ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
            onChange(markdown);
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(listener)
        .use(preventBackspaceNav),
    // Re-create the editor when the seed value identity changes (i.e. after the
    // source-mode escape hatch rewrites the body). See BodyEditor.
    [value],
  );

  return <Milkdown />;
}

/**
 * Body editor for an object's Markdown (SPEC §8): a markdown-native WYSIWYG
 * (Milkdown) with a **raw/source toggle** escape hatch.
 *
 * Milkdown's React binding is uncontrolled, so rather than fight it with a
 * controlled-value bridge, the source toggle uses a deliberately simple contract:
 * edits in either mode flow up through `onChange`, and switching back to WYSIWYG
 * **remounts** the editor (via the `[value]` dep in {@link Wysiwyg}) so it re-seeds
 * from whatever the source textarea left behind. Robust, and good enough for the
 * de-risk slice; a smoother controlled bridge can come later.
 */
export function BodyEditor({ value, onChange }: BodyEditorProps): React.JSX.Element {
  const [mode, setMode] = useState<'wysiwyg' | 'source'>('wysiwyg');

  const onSourceChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    [onChange],
  );

  return (
    <div className="body-editor">
      <div className="body-editor__toolbar">
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'wysiwyg' ? 'source' : 'wysiwyg'))}
        >
          {mode === 'wysiwyg' ? 'View source' : 'Back to editor'}
        </button>
      </div>

      {mode === 'wysiwyg' ? (
        <MilkdownProvider>
          <Wysiwyg value={value} onChange={onChange} />
        </MilkdownProvider>
      ) : (
        <textarea
          className="body-editor__source"
          value={value}
          onChange={onSourceChange}
          spellCheck={false}
          aria-label="Markdown source"
        />
      )}
    </div>
  );
}
