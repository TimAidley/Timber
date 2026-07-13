import { useState } from 'react';
import { CodeEditor } from './CodeEditor.js';
import { CheatSheet } from './CheatSheet.js';
import type { AdvancedFile } from './loadAdvancedFiles.js';
import type { AdvancedValidation } from './validate.js';
import { DiffView } from '../diff/DiffView.js';
import { useRefText } from '../diff/useRefText.js';
import type { RepoSession } from '../state/repoSession.js';

interface AdvancedEditorPanelProps {
  session: RepoSession;
  file: AdvancedFile;
  /** The current working text (advanced.value). */
  value: string;
  validation: AdvancedValidation | undefined;
  onChange: (next: string) => void;
  /** Revert this file to its published version (advanced.revert); resolves when done. */
  onRevert: (path: string) => Promise<void>;
}

/**
 * The advanced-area editor surface (SPEC §8), with an **Edit** tab (the CodeEditor +
 * validation) and a **Diff** tab (the file's unpublished changes vs. the published
 * version, with a guarded Revert). Mirrors the content body editor's tabbed shape so
 * templates/config get the same see-your-changes / revert affordances as pages —
 * only over raw text (no WYSIWYG), which is all a `.liquid`/`.yml` file needs.
 */
export function AdvancedEditorPanel({
  session,
  file,
  value,
  validation,
  onChange,
  onRevert,
}: AdvancedEditorPanelProps): React.JSX.Element {
  const [mode, setMode] = useState<'edit' | 'diff'>('edit');
  const [confirming, setConfirming] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  // Published base for the Diff tab, fetched only while that tab is open. A 404 → null
  // (a file added on WIP) renders as all-additions.
  const base = useRefText(session.client, file.path, session.defaultBranch, mode === 'diff');
  const hasChanges = !base.loading && base.error === null && base.text !== value;

  async function doRevert(): Promise<void> {
    setReverting(true);
    setRevertError(null);
    try {
      await onRevert(file.path);
      setConfirming(false);
      setMode('edit');
    } catch (err) {
      setRevertError(err instanceof Error ? err.message : String(err));
    } finally {
      setReverting(false);
    }
  }

  return (
    <section className="editor-panel">
      <div className="body-editor__tabs" role="tablist" aria-label="Advanced file mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'edit'}
          className={`body-editor__tab${mode === 'edit' ? ' is-active' : ''}`}
          onClick={() => setMode('edit')}
        >
          Edit
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'diff'}
          className={`body-editor__tab${mode === 'diff' ? ' is-active' : ''}`}
          onClick={() => setMode('diff')}
          title="Unpublished changes to this file"
        >
          Diff
        </button>
      </div>

      {mode === 'edit' ? (
        <>
          <CodeEditor value={value} kind={file.kind} onChange={onChange} />
          {validation && !validation.valid ? (
            <div className="advanced__validation advanced__validation--bad" role="alert">
              <strong>Not saved to your branch — fix before it can be committed:</strong>
              <ul>
                {validation.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              <p className="advanced__hint">Your draft is kept locally so nothing is lost.</p>
            </div>
          ) : (
            <div className="advanced__validation advanced__validation--ok">✓ Valid — saved to your branch</div>
          )}
          {file.kind === 'schema' ? <CheatSheet /> : null}
        </>
      ) : (
        <>
          <div className="body-editor__diffbar">
            {confirming ? (
              <div className="advanced__revert-confirm">
                <span>Revert to the published version? This drops your unpublished changes to this file.</span>
                <button type="button" className="body-editor__revert" onClick={() => void doRevert()} disabled={reverting}>
                  {reverting ? 'Reverting…' : 'Revert'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={reverting}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="body-editor__revert"
                onClick={() => setConfirming(true)}
                disabled={!hasChanges}
                title="Revert this file to its published version."
              >
                Revert file
              </button>
            )}
          </div>
          {revertError ? (
            <div className="advanced__validation advanced__validation--bad" role="alert">
              <strong>Couldn’t revert:</strong> {revertError}
            </div>
          ) : null}
          <DiffView
            base={base.text}
            working={value}
            loading={base.loading}
            error={base.error}
            emptyLabel="No unpublished changes to this file."
          />
        </>
      )}
    </section>
  );
}
