import { useCallback, useState } from 'react';
import { Editor, rootCtx, defaultValueCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import { callCommand } from '@milkdown/kit/utils';
import type { CmdKey } from '@milkdown/kit/core';
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  wrapInHeadingCommand,
  turnIntoTextCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  insertHrCommand,
} from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand, insertTableCommand } from '@milkdown/kit/preset/gfm';
import { remarkStringifyOptions } from './milkdown.js';
import { preventBackspaceNav } from './backspaceFix.js';
import { Toolbar } from './Toolbar.js';

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
 * The formatting icon bar for the WYSIWYG tab. Every action is a Milkdown editor
 * command run through `callCommand`, so the toolbar buttons and the keyboard
 * shortcuts drive the exact same code paths (and the same canonical serialization).
 *
 * Must be rendered inside {@link MilkdownProvider} so `useInstance` can reach the
 * live editor. Buttons use `onMouseDown` + `preventDefault` so clicking one never
 * steals focus (or the text selection) from the editor — the command then applies
 * to whatever the caret/selection was.
 */
function WysiwygToolbar(): React.JSX.Element {
  const [loading, getInstance] = useInstance();

  const run = useCallback(
    <T,>(key: CmdKey<T>, payload?: T): void => {
      if (loading) return;
      getInstance()?.action(callCommand(key, payload));
    },
    [loading, getInstance],
  );

  const addLink = useCallback((): void => {
    const href = window.prompt('Link URL');
    if (href) run(toggleLinkCommand.key, { href });
  }, [run]);

  return (
    <Toolbar
      disabled={loading}
      groups={[
        [
          { label: 'Bold', shortcut: 'Ctrl+B', icon: 'bold', onClick: () => run(toggleStrongCommand.key) },
          { label: 'Italic', shortcut: 'Ctrl+I', icon: 'italic', onClick: () => run(toggleEmphasisCommand.key) },
          {
            label: 'Strikethrough',
            icon: 'strikethrough',
            onClick: () => run(toggleStrikethroughCommand.key),
          },
          {
            label: 'Inline code',
            shortcut: 'Ctrl+E',
            icon: 'code',
            onClick: () => run(toggleInlineCodeCommand.key),
          },
          { label: 'Link', icon: 'link', onClick: addLink },
        ],
        [
          { label: 'Heading 1', icon: 'h1', onClick: () => run(wrapInHeadingCommand.key, 1) },
          { label: 'Heading 2', icon: 'h2', onClick: () => run(wrapInHeadingCommand.key, 2) },
          { label: 'Heading 3', icon: 'h3', onClick: () => run(wrapInHeadingCommand.key, 3) },
          { label: 'Paragraph', icon: 'paragraph', onClick: () => run(turnIntoTextCommand.key) },
        ],
        [
          { label: 'Bullet list', icon: 'bulletList', onClick: () => run(wrapInBulletListCommand.key) },
          { label: 'Numbered list', icon: 'orderedList', onClick: () => run(wrapInOrderedListCommand.key) },
          { label: 'Quote', icon: 'quote', onClick: () => run(wrapInBlockquoteCommand.key) },
          { label: 'Code block', icon: 'codeBlock', onClick: () => run(createCodeBlockCommand.key) },
        ],
        [
          { label: 'Divider', icon: 'hr', onClick: () => run(insertHrCommand.key) },
          {
            label: 'Table',
            icon: 'table',
            onClick: () => run(insertTableCommand.key, { row: 3, col: 3 }),
          },
        ],
      ]}
    />
  );
}

/**
 * Body editor for an object's Markdown (SPEC §8): a markdown-native WYSIWYG
 * (Milkdown) with a **raw-Markdown tab** escape hatch.
 *
 * The two views are surfaced as tabs — "Editor" (WYSIWYG, the default) and
 * "Markdown" (raw source). Milkdown's React binding is uncontrolled, so rather
 * than fight it with a controlled-value bridge, the tab switch uses a deliberately
 * simple contract: edits in either view flow up through `onChange`, and switching
 * back to the editor **remounts** Milkdown (it is unmounted while the Markdown tab
 * is active), so it re-seeds from whatever the source textarea left behind. Robust,
 * and good enough for the de-risk slice; a smoother controlled bridge can come later.
 */
export function BodyEditor({ value, onChange, docKey }: BodyEditorProps): React.JSX.Element {
  const [mode, setMode] = useState<'wysiwyg' | 'source'>('wysiwyg');

  const onSourceChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    [onChange],
  );

  return (
    <div className="body-editor">
      <div className="body-editor__tabs" role="tablist" aria-label="Body editor mode">
        <button
          type="button"
          role="tab"
          id="body-editor-tab-wysiwyg"
          aria-selected={mode === 'wysiwyg'}
          aria-controls="body-editor-panel"
          className={`body-editor__tab${mode === 'wysiwyg' ? ' is-active' : ''}`}
          onClick={() => setMode('wysiwyg')}
        >
          Editor
        </button>
        <button
          type="button"
          role="tab"
          id="body-editor-tab-source"
          aria-selected={mode === 'source'}
          aria-controls="body-editor-panel"
          className={`body-editor__tab${mode === 'source' ? ' is-active' : ''}`}
          onClick={() => setMode('source')}
        >
          Markdown
        </button>
      </div>

      <div
        id="body-editor-panel"
        role="tabpanel"
        aria-labelledby={mode === 'wysiwyg' ? 'body-editor-tab-wysiwyg' : 'body-editor-tab-source'}
      >
        {mode === 'wysiwyg' ? (
          <MilkdownProvider>
            <WysiwygToolbar />
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
    </div>
  );
}
