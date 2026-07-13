import { useCallback, useEffect, useRef, useState } from 'react';
import { Editor, rootCtx, defaultValueCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { cursor } from '@milkdown/kit/plugin/cursor';
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import { ProsemirrorAdapterProvider, useNodeViewFactory } from '@prosemirror-adapter/react';
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
import {
  AssetStoreProvider,
  figureKeymap,
  figureRemark,
  figureSchema,
  figureView,
  insertFigureCommand,
} from './figure/index.js';
import { processImage } from '../media/processImage.js';
import { bundleImagePath } from '../media/assetName.js';
import type { AssetStore } from '../state/assets.js';
import { DiffView } from '../diff/DiffView.js';

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

interface BodyEditorProps extends WysiwygProps {
  /** Staging area for processed image bytes (SPEC §7); also feeds figure thumbnails. */
  assetStore: AssetStore;
  /** The object's bundle directory, e.g. `content/events/summer-fete`. */
  bundleDir: string;
  /** Notified with a staged asset's repo path so autosave commits its bytes. */
  onStaged?: ((path: string) => void) | undefined;
  /**
   * The current working `index.md` (front matter + body) for the **Diff** tab. When
   * this and {@link getPublishedText} are both supplied, a third "Diff" tab appears
   * showing the whole page's unpublished changes against the published version. Omit
   * (e.g. the demo/tests) to hide the tab. It's the full document — not just the body —
   * so front-matter/field edits show too (SPEC §8).
   */
  diffWorkingText?: string;
  /** Fetch the published `index.md` (default branch), or null if the page is brand-new. */
  getPublishedText?: () => Promise<string | null>;
  /** Revert the whole page to its published version (shown on the Diff tab when there are changes). */
  onRevert?: (() => void) | undefined;
}

/**
 * The Milkdown WYSIWYG instance. It seeds from `value` once (Milkdown's React
 * binding is uncontrolled — see the raw/source toggle note in {@link BodyEditor}),
 * pins Timber's canonical serialization (`remarkStringifyOptionsCtx`, the SAME
 * config the round-trip tests prove), and reports edits via the listener plugin's
 * `markdownUpdated`. The `figure*` plugins add the `:::figure` image node (schema +
 * live NodeView), bound to the ProseMirror adapter's node-view factory.
 */
function Wysiwyg({ value, onChange, docKey }: WysiwygProps): React.JSX.Element {
  const nodeViewFactory = useNodeViewFactory();

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
        .use(cursor)
        // Undo/redo history (keymap: Ctrl/Cmd+Z, Ctrl+Y, Ctrl/Cmd+Shift+Z) plus the
        // toolbar Undo/Redo buttons, which are the only way to undo on mobile where
        // there is no keyboard shortcut.
        .use(history)
        .use(preventBackspaceNav)
        .use(figureRemark)
        .use(figureSchema)
        .use(figureKeymap)
        .use(insertFigureCommand)
        .use(figureView(nodeViewFactory)),
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
function WysiwygToolbar({
  assetStore,
  bundleDir,
  onStaged,
}: Pick<BodyEditorProps, 'assetStore' | 'bundleDir' | 'onStaged'>): React.JSX.Element {
  const [loading, getInstance] = useInstance();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

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

  const onImageFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-picking the same file
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        window.alert(`Not an image: ${file.type || 'unknown type'}`);
        return;
      }
      // Alt text is mandatory for accessibility (SPEC §7). Cancelling aborts insert.
      const alt = window.prompt('Describe this image for screen readers (alt text)');
      if (alt === null) return;
      setBusy(true);
      try {
        const processed = await processImage(file);
        const path = bundleImagePath(bundleDir, file.name, processed.mime);
        assetStore.stage(path, processed.blob);
        onStaged?.(path);
        run(insertFigureCommand.key, { src: path, alt });
      } catch (err) {
        window.alert(`Could not process image: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [assetStore, bundleDir, onStaged, run],
  );

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void onImageFile(e)}
      />
      <Toolbar
        disabled={loading}
        groups={[
          [
            { label: 'Undo', shortcut: 'Ctrl+Z', icon: 'undo', onClick: () => run(undoCommand.key) },
            { label: 'Redo', shortcut: 'Ctrl+Y', icon: 'redo', onClick: () => run(redoCommand.key) },
          ],
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
            {
              label: busy ? 'Processing image…' : 'Image',
              icon: 'image',
              onClick: () => fileInput.current?.click(),
            },
          ],
        ]}
      />
    </>
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
 *
 * Wrapped in `AssetStoreProvider` (outermost, so adapter-rendered figure NodeViews can
 * resolve — and lazily re-fetch — image URLs wherever they mount) and
 * `ProsemirrorAdapterProvider` (React NodeViews).
 */
export function BodyEditor({
  value,
  onChange,
  docKey,
  assetStore,
  bundleDir,
  onStaged,
  diffWorkingText,
  getPublishedText,
  onRevert,
}: BodyEditorProps): React.JSX.Element {
  const [mode, setMode] = useState<'wysiwyg' | 'source' | 'diff'>('wysiwyg');
  const showDiffTab = diffWorkingText !== undefined && getPublishedText !== undefined;

  const onSourceChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    [onChange],
  );

  // The published `index.md` for the Diff tab, fetched lazily the first time that tab
  // is opened and re-fetched when the document changes (docKey bumps on object switch).
  // Keyed by docKey so a stale base from the previously selected object is never shown.
  const [base, setBase] = useState<{ seed: number; text: string | null } | null>(null);
  const [baseLoading, setBaseLoading] = useState(false);
  const [baseError, setBaseError] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'diff' || !getPublishedText) return;
    if (base?.seed === docKey) return; // already have this document's base
    let cancelled = false;
    setBaseLoading(true);
    setBaseError(null);
    getPublishedText()
      .then((text) => {
        if (!cancelled) setBase({ seed: docKey, text });
      })
      .catch((err: unknown) => {
        if (!cancelled) setBaseError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBaseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, docKey, getPublishedText, base]);

  // If the document switches while the Diff tab is open, drop back to the editor so we
  // never flash the previous page's diff against the new page's text.
  useEffect(() => {
    // React only to a document change (docKey), not to a mode toggle — the functional
    // update reads the latest mode without needing it in the dependency list.
    setMode((m) => (m === 'diff' ? 'wysiwyg' : m));
  }, [docKey]);

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
        {showDiffTab ? (
          <button
            type="button"
            role="tab"
            id="body-editor-tab-diff"
            aria-selected={mode === 'diff'}
            aria-controls="body-editor-panel"
            className={`body-editor__tab${mode === 'diff' ? ' is-active' : ''}`}
            onClick={() => setMode('diff')}
            title="Unpublished changes to this page (front matter + body)"
          >
            Diff
          </button>
        ) : null}
      </div>

      <div
        id="body-editor-panel"
        role="tabpanel"
        aria-labelledby={
          mode === 'wysiwyg'
            ? 'body-editor-tab-wysiwyg'
            : mode === 'diff'
              ? 'body-editor-tab-diff'
              : 'body-editor-tab-source'
        }
      >
        {mode === 'wysiwyg' ? (
          <AssetStoreProvider value={assetStore}>
            <MilkdownProvider>
              <ProsemirrorAdapterProvider>
                <WysiwygToolbar assetStore={assetStore} bundleDir={bundleDir} onStaged={onStaged} />
                <Wysiwyg value={value} onChange={onChange} docKey={docKey} />
              </ProsemirrorAdapterProvider>
            </MilkdownProvider>
          </AssetStoreProvider>
        ) : mode === 'diff' ? (
          <>
            {onRevert ? (
              <div className="body-editor__diffbar">
                <button
                  type="button"
                  className="body-editor__revert"
                  onClick={onRevert}
                  title="Discard this page's unpublished changes — revert it to the published version."
                >
                  Revert page
                </button>
              </div>
            ) : null}
            <DiffView
              base={base?.seed === docKey ? base.text : null}
              working={diffWorkingText ?? ''}
              loading={baseLoading || base?.seed !== docKey}
              error={baseError}
              emptyLabel="No unpublished changes to this page."
            />
          </>
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
