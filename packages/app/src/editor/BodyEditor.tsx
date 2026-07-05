import { useCallback, useState } from 'react';
import { Editor, rootCtx, defaultValueCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { remarkStringifyOptions } from './milkdown.js';
import { preventBackspaceNav } from './backspaceFix.js';

interface WysiwygProps {
  /** Current Markdown body (canonical form). */
  value: string;
  /** Called with the new Markdown whenever the body changes. */
  onChange: (markdown: string) => void;
  /**
   * Identity of the document being edited. Changes only on an EXTERNAL re-seed
   * (switching objects, restoring a draft) — NOT on the editor's own keystrokes.
   * The editor recreates on this, so it re-seeds when the document changes but keeps
   * the caret/focus while you type. (Recreating on `value` instead blurred the editor
   * on every edit, which let the next Backspace escape to the browser.)
   */
  docKey: number;
}

type BodyEditorProps = WysiwygProps;

/**
 * The Milkdown WYSIWYG instance. It seeds from `value` once (Milkdown's React
 * binding is uncontrolled — see the raw/source toggle note in {@link BodyEditor}),
 * pins Timber's canonical serialization (`remarkStringifyOptionsCtx`, the SAME
 * config the round-trip tests prove), and reports edits via the listener plugin's
 * `markdownUpdated`.
 */
function Wysiwyg({ value, onChange, docKey }: WysiwygProps): React.JSX.Element {
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
    // Re-seed only when the document identity changes (object switch / draft restore),
    // NOT on every keystroke — recreating per edit blurred the editor. `value` is read
    // fresh here because it updates in the same render that bumps `docKey`.
    [docKey],
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
export function BodyEditor({ value, onChange, docKey }: BodyEditorProps): React.JSX.Element {
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
          <Wysiwyg value={value} onChange={onChange} docKey={docKey} />
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
