import { useMemo, useState } from 'react';
import { validateRename, type RenameTypePlan } from '../advanced/renameType.js';

interface RenameTypeDialogProps {
  /** The type being renamed. */
  typeName: string;
  /** Type names already in use — the new name must not collide. */
  existingNames: ReadonlySet<string>;
  /** Compute what a rename to this name would touch (shown as a preview before confirming). */
  plan: (newName: string) => RenameTypePlan;
  onClose: () => void;
  /**
   * Execute the rename; resolves once the change is on the branch (`true`) or is still
   * local because the save failed (`false` — the autosaver keeps retrying).
   */
  onRename: (plan: RenameTypePlan) => Promise<boolean>;
}

/** Reload the editor so the renamed type is picked up by the content model. */
function reloadEditor(): void {
  window.location.reload();
}

/**
 * "Rename content type" dialog (SPEC §8). Renaming a type moves its schema file, every
 * object bundle under `content/<type>/`, its per-type template, and any schema that
 * references it — one coalesced commit — and leaves the old URLs redirecting to the new
 * ones. The dialog previews exactly what will move and lists the mentions it will *not*
 * rewrite (loops in templates, hand-typed URLs) so the author can fix those by hand.
 * Because the content model is built at load time, the rename ends in a reload.
 */
export function RenameTypeDialog({
  typeName,
  existingNames,
  plan,
  onClose,
  onRename,
}: RenameTypeDialogProps): React.JSX.Element {
  const [name, setName] = useState(typeName);
  const [phase, setPhase] = useState<'edit' | 'saving' | 'done'>('edit');
  const [saveFailed, setSaveFailed] = useState(false);

  const newName = name.trim();
  const error = validateRename(typeName, newName, existingNames);
  const showError = newName !== '' && newName !== typeName && error !== null;
  const preview = useMemo(
    () => (error === null ? plan(newName) : null),
    [error, newName, plan],
  );

  async function submit(): Promise<void> {
    if (!preview || phase !== 'edit') return;
    setPhase('saving');
    const landed = await onRename(preview);
    setSaveFailed(!landed);
    setPhase('done');
  }

  if (phase === 'done') {
    return (
      <div className="modal" role="dialog" aria-label="Content type renamed">
        <div className="modal__panel">
          <header className="modal__header">
            <h2>
              Renamed “{typeName}” to “{newName}”
            </h2>
          </header>
          {saveFailed ? (
            <p className="publish__error" role="alert">
              The change is saved on this device but hasn’t reached your branch yet — it
              will be retried automatically. Reload once you’re back online.
            </p>
          ) : (
            <p className="new-type__hint">The rename is saved to your branch.</p>
          )}
          <p className="new-type__hint">
            <strong>Reload the editor</strong> to continue — the content model is built
            when the editor loads.
          </p>
          <div className="modal__actions">
            <button type="button" className="is-primary" onClick={reloadEditor}>
              Reload editor
            </button>
          </div>
        </div>
      </div>
    );
  }

  const objectCount = preview?.objectMoves.length ?? 0;
  const templateCount =
    (preview?.templateMoves.length ?? 0) + (preview?.templateShaMoves.length ?? 0);
  const busy = phase === 'saving';

  return (
    <div className="modal" role="dialog" aria-label="Rename content type">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>Rename “{typeName}”</h2>
          <button type="button" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </header>

        <p className="publish__summary">
          Moves the schema and every “{typeName}” item to the new name, and updates
          anything that refers to the type. Old page addresses redirect to the new ones.
        </p>

        <label className="publish__message">
          New name
          <input
            autoFocus
            value={name}
            disabled={busy}
            aria-invalid={showError}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </label>
        {showError ? (
          <p className="new-type__error" role="alert">
            {error}
          </p>
        ) : (
          <p className="rename__preview">
            Schema: <code>config/schemas/{newName || '…'}.yml</code> · content:{' '}
            <code>content/{newName || '…'}/</code>
          </p>
        )}

        {preview ? (
          <div className="new-type__hint">
            <p>
              Will move <strong>{objectCount}</strong>{' '}
              {objectCount === 1 ? 'item' : 'items'}
              {templateCount > 0
                ? ` and ${templateCount} ${templateCount === 1 ? 'template' : 'templates'}`
                : ''}
              {preview.schemaRewrites.length > 0
                ? `, and update ${preview.schemaRewrites.length} ${
                    preview.schemaRewrites.length === 1 ? 'schema' : 'schemas'
                  } that reference it`
                : ''}
              .
            </p>
            {preview.warnings.length > 0 ? (
              <>
                <p>
                  <strong>Check these by hand afterwards:</strong>
                </p>
                <ul className="rename-type__warnings">
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="modal__actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={error !== null || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Renaming…' : 'Rename'}
          </button>
        </div>
      </div>
    </div>
  );
}
