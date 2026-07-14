import { useState } from 'react';
import {
  newFilePath,
  validateFileName,
  type NewFileKind,
  type NewFileOptions,
} from '../advanced/newFile.js';

interface NewFileDialogProps {
  /** Every existing advanced file path — creation is blocked for a colliding path. */
  existingPaths: ReadonlySet<string>;
  onClose: () => void;
  /** Confirmed a valid new-file definition → author its starter content. */
  onCreate: (opts: NewFileOptions) => void;
}

/**
 * "New file" dialog for the advanced area (SPEC §8). Adds a **template** (`.liquid`) or
 * a plain **config** (`.yml`) file — the create affordance that "New type" (schemas)
 * didn't cover. Collects a kind + a slug-safe name and previews the resulting repo path;
 * the caller turns the result into starter content and commits it through the shared
 * advanced edit-preview-commit loop. No reload nudge (unlike a new type): a template or
 * config file changes nothing in the content model, so it's live in preview immediately.
 */
export function NewFileDialog({
  existingPaths,
  onClose,
  onCreate,
}: NewFileDialogProps): React.JSX.Element {
  const [kind, setKind] = useState<NewFileKind>('template');
  const [name, setName] = useState('');

  const nameError = validateFileName(kind, name, existingPaths);
  // Only scold a name once the author has typed something (not an empty field on open).
  const showError = name.trim() !== '' && nameError !== null;
  const path = name.trim() ? newFilePath({ kind, name: name.trim() }) : null;

  function submit(): void {
    if (nameError) return;
    onCreate({ kind, name: name.trim() });
    onClose();
  }

  return (
    <div className="modal" role="dialog" aria-label="New file">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>New file</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <fieldset className="new-type__group">
          <legend>Kind</legend>
          <label>
            <input
              type="radio"
              name="file-kind"
              checked={kind === 'template'}
              onChange={() => setKind('template')}
            />
            <span>
              <strong>Template</strong> — a <code>.liquid</code> page. Named after a
              content type (events, people…) it styles that type’s pages.
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="file-kind"
              checked={kind === 'config'}
              onChange={() => setKind('config')}
            />
            <span>
              <strong>Config</strong> — a <code>.yml</code> data file your templates read
              (like navigation). For a new content type, use <strong>New type</strong>{' '}
              instead.
            </span>
          </label>
        </fieldset>

        <label className="publish__message">
          Name
          <input
            autoFocus
            value={name}
            placeholder={kind === 'template' ? 'e.g. events' : 'e.g. navigation'}
            aria-invalid={showError}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </label>
        {showError ? (
          <p className="new-type__error" role="alert">
            {nameError}
          </p>
        ) : (
          <p className="new-type__hint">
            Saved as <code>{path ?? newFilePath({ kind, name: 'name' })}</code>.
          </p>
        )}

        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={nameError !== null}
            onClick={submit}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
