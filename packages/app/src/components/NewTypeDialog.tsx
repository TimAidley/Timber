import { useState } from 'react';
import type { ContentTypeKind } from '@timber/content';
import {
  defaultsForKind,
  validateTypeName,
  type NewTypeOptions,
} from '../advanced/schemaTemplate.js';

interface NewTypeDialogProps {
  /** Type names already in use — creation is blocked for these. */
  existingNames: ReadonlySet<string>;
  onClose: () => void;
  /** Confirmed a valid new-type definition → author its starter schema. */
  onCreate: (opts: NewTypeOptions) => void;
}

/** Reload the editor so a just-created type is picked up by the content model. */
function reloadEditor(): void {
  window.location.reload();
}

/**
 * "New content type" dialog (SPEC §8 advanced area). Collects a name plus the few
 * settings that shape a type — collection vs singleton, whether it renders as a page,
 * and whether it has a Markdown body — **pre-filling sensible defaults** from the kind
 * (a collection is a page with a body; a singleton is `settings`-style config). The
 * caller turns the result into a `config/schemas/<name>.yml` starter and commits it
 * through the shared advanced edit-preview-commit loop.
 */
export function NewTypeDialog({
  existingNames,
  onClose,
  onCreate,
}: NewTypeDialogProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ContentTypeKind>('collection');
  const initial = defaultsForKind('collection');
  const [page, setPage] = useState(initial.page);
  const [hasBody, setHasBody] = useState(initial.hasBody);
  // Once created, swap the form for a confirmation that nudges the reload needed to
  // start adding content of the new type (the content model is built at load time).
  const [created, setCreated] = useState<string | null>(null);

  // Picking a kind re-seeds the flags with that kind's defaults; the author can still
  // override either afterwards. This is the "prefill appropriate defaults" behaviour.
  function chooseKind(next: ContentTypeKind): void {
    setKind(next);
    const d = defaultsForKind(next);
    setPage(d.page);
    setHasBody(d.hasBody);
  }

  const nameError = validateTypeName(name, existingNames);
  // Only surface the error once the author has typed something (don't scold an empty
  // field on open).
  const showError = name.trim() !== '' && nameError !== null;

  function submit(): void {
    if (nameError) return;
    const created = name.trim();
    onCreate({ name: created, kind, page, hasBody });
    setCreated(created);
  }

  if (created !== null) {
    return (
      <div className="modal" role="dialog" aria-label="Content type created">
        <div className="modal__panel">
          <header className="modal__header">
            <h2>Type “{created}” created</h2>
            <button type="button" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </header>

          <p className="new-type__hint">
            Saved to your branch as <code>config/schemas/{created}.yml</code>, and open in
            the editor to add fields.
          </p>
          <p className="new-type__hint">
            <strong>Reload the editor</strong> to start adding content of this type — the
            content model is built when the editor loads.
          </p>

          <div className="modal__actions">
            <button type="button" onClick={onClose}>
              Keep editing the schema
            </button>
            <button type="button" className="is-primary" onClick={reloadEditor}>
              Reload editor
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal" role="dialog" aria-label="New content type">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>New content type</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <label className="publish__message">
          Name
          <input
            autoFocus
            value={name}
            placeholder="e.g. events"
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
            Saved as <code>config/schemas/{name.trim() || 'name'}.yml</code>.
          </p>
        )}

        <fieldset className="new-type__group">
          <legend>Kind</legend>
          <label>
            <input
              type="radio"
              name="kind"
              checked={kind === 'collection'}
              onChange={() => chooseKind('collection')}
            />
            <span>
              <strong>Collection</strong> — many objects (events, people, posts…)
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="kind"
              checked={kind === 'singleton'}
              onChange={() => chooseKind('singleton')}
            />
            <span>
              <strong>Singleton</strong> — exactly one (site settings, homepage…)
            </span>
          </label>
        </fieldset>

        <fieldset className="new-type__group">
          <legend>Settings</legend>
          <label>
            <input
              type="checkbox"
              checked={page}
              onChange={(e) => setPage(e.target.checked)}
            />
            <span>Renders as its own page</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={hasBody}
              onChange={(e) => setHasBody(e.target.checked)}
            />
            <span>Has a Markdown body</span>
          </label>
        </fieldset>

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
