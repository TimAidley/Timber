import { referrersTo, type ContentModel, type ContentObject } from '@timber/content';

interface DeleteDialogProps {
  object: ContentObject;
  model: ContentModel;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Guarded-delete confirmation (SPEC §5: "guarded by a warning that lists what
 * references the object"). Deleting is always allowed after confirmation — any
 * resulting dangling references then surface in validation and the pre-publish
 * validity gate blocks going public (resolve-first, not silent breakage).
 */
export function DeleteDialog({ object, model, onClose, onConfirm }: DeleteDialogProps): React.JSX.Element {
  const referrers = object.id ? referrersTo(model, object.id) : [];
  const name = String(object.data.title ?? object.slug);

  return (
    <div className="modal" role="dialog" aria-label="Delete object">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>Delete “{name}”?</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="publish__summary">
          This marks the whole bundle (<code>{object.path.replace(/\/index\.md$/, '/')}</code>) — its{' '}
          <code>index.md</code> and any colocated assets — for deletion. It stays in the list (struck through) as a
          pending change you can <strong>restore</strong> until you publish; publishing removes it from the live site.
        </p>

        {referrers.length > 0 ? (
          <div className="delete__referrers">
            <p>
              ⚠ {referrers.length} object{referrers.length === 1 ? '' : 's'} still reference this one. Deleting will
              leave {referrers.length === 1 ? 'it' : 'them'} with a dangling reference (which blocks publishing until
              fixed):
            </p>
            <ul className="publish__diff">
              {referrers.map((r) => (
                <li key={r.path}>{String(r.data.title ?? r.slug)}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="publish__summary">Nothing references this object.</p>
        )}

        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="is-danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
