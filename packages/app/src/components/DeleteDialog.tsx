import {
  navigationReferrers,
  referrersTo,
  type ContentModel,
  type ContentObject,
  type NavEntry,
} from '@timber/content';

interface DeleteDialogProps {
  object: ContentObject;
  model: ContentModel;
  /**
   * The site menu as authored (SPEC §13). `referrersTo` only sweeps schema `reference`
   * fields, so without this a page linked from the navigation could be deleted with the
   * dialog cheerfully reporting that nothing references it — and the menu item would
   * then vanish silently at build time.
   */
  navigation?: NavEntry[];
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Guarded-delete confirmation (SPEC §5: "guarded by a warning that lists what
 * references the object"). Deleting is always allowed after confirmation — any
 * resulting dangling references then surface in validation and the pre-publish
 * validity gate blocks going public (resolve-first, not silent breakage). A dangling
 * *navigation* entry is advisory rather than blocking (SPEC §13), so it's called out
 * separately: the site still builds, it just loses that menu item.
 */
export function DeleteDialog({
  object,
  model,
  navigation = [],
  onClose,
  onConfirm,
}: DeleteDialogProps): React.JSX.Element {
  const referrers = object.id ? referrersTo(model, object.id) : [];
  const navReferrers = object.id ? navigationReferrers(navigation, object.id) : [];
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
        ) : null}

        {navReferrers.length > 0 ? (
          <div className="delete__referrers">
            <p>
              ⚠ This page is in the site menu as{' '}
              {navReferrers.map((e, i) => (
                <span key={`${e.ref}-${i}`}>
                  {i > 0 ? ', ' : ''}
                  <strong>“{e.label || '(untitled)'}”</strong>
                </span>
              ))}
              . Deleting it leaves that entry pointing at nothing, so it will disappear from the
              menu — edit the navigation to remove or repoint it.
            </p>
          </div>
        ) : null}

        {referrers.length === 0 && navReferrers.length === 0 ? (
          <p className="publish__summary">Nothing references this object.</p>
        ) : null}

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
