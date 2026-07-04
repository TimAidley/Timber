import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { yaml } from '@codemirror/lang-yaml';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import type { AdvancedKind } from './loadAdvancedFiles.js';

/** Pick the syntax-highlighting extension for a file kind. Liquid is HTML-with-tags,
 * so HTML highlighting is a good-enough surface without a bespoke Liquid mode. */
function languageFor(kind: AdvancedKind): Extension {
  return kind === 'template' ? html() : yaml();
}

/**
 * A thin React wrapper over CodeMirror 6 (the locked editor choice). It seeds from
 * `value` on mount and on external replacement (switching files / restoring a draft),
 * and emits every edit via `onChange`. Kept deliberately small — highlighting +
 * editing surface only; validation, preview, and the commit gate live in
 * {@link AdvancedArea}.
 */
export function CodeEditor({
  value,
  kind,
  onChange,
}: {
  value: string;
  kind: AdvancedKind;
  onChange: (next: string) => void;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Keep the latest onChange without re-creating the editor on every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab, ...defaultKeymap]),
        languageFor(kind),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    const editor = new EditorView({ state, parent: host.current });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Re-mount only when the language changes; external value edits are reconciled
    // in the effect below, so `value` is intentionally not a dependency here.
  }, [kind]);

  // Reconcile external value changes (file switch / draft restore) without clobbering
  // in-progress typing: only replace when the editor's text actually differs.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current !== value) {
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div className="code-editor" ref={host} />;
}
