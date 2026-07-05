import type { ContentObject } from '@timber/content';

interface DiscardDialogProps {
  object: ContentObject;
  /** True if the object was never published (brand-new) — discard removes it entirely. */
  brandNew: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Confirm discarding a page's unpublished changes (SPEC §5). Reverting to the
 * published version drops edits already committed to the WIP branch, so — like delete
 * — it's guarded. A brand-new (never-published) page has no version to revert to, so
 * discard removes it outright; the copy makes that explicit.
 */
export function DiscardDialog({ object, brandNew, busy, onClose, onConfirm }: DiscardDialogProps): React.JSX.Element {
  const name = String(object.data.title ?? object.slug);
  return (
    <div className="modal" role="dialog" aria-label="Discard changes">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>{brandNew ? `Discard “${name}”?` : `Discard changes to “${name}”?`}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="publish__summary">
          {brandNew ? (
            <>
              This page hasn’t been published yet, so there’s no version to revert to — discarding{' '}
              <strong>removes it</strong> along with its colocated assets.
            </>
          ) : (
            <>
              This reverts the page to the <strong>published</strong> version, dropping every unpublished change to
              it — including edits already saved to your branch. It can’t be undone.
            </>
          )}
        </p>

        <div className="modal__actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="is-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Discarding…' : brandNew ? 'Discard' : 'Discard changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
