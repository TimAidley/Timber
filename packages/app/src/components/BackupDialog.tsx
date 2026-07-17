import type { ContentObject } from '@timber/content';
import type { RepoVisibility } from '@timber/host';

interface BackupDialogProps {
  object: ContentObject;
  /** Repo visibility (SPEC §5) — sets how exposed "backed up" actually is. */
  visibility: RepoVisibility;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Confirm backing up an **On this device** object to the repo (SPEC §5/§8 storage
 * axis). This is where privacy is actually decided: on a public repo the object
 * becomes visible to anyone, and git history is permanent — so the copy is explicit
 * about exposure and keys off repo visibility rather than assuming GitHub.
 */
export function BackupDialog({ object, visibility, onClose, onConfirm }: BackupDialogProps): React.JSX.Element {
  const name = String(object.data.title ?? object.slug);
  return (
    <div className="modal" role="dialog" aria-label="Back up to the repo">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>Back up “{name}” to the repo?</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="publish__summary">
          {visibility === 'public' ? (
            <>
              This commits the page to your content repo, where it becomes{' '}
              <strong>visible to anyone who can see the repo</strong>. Git history is permanent, so
              this can’t be fully undone — but the page still won’t appear on the live site until
              it’s public and published.
            </>
          ) : visibility === 'private' ? (
            <>
              This commits the page to your content repo — <strong>visible to your collaborators</strong>{' '}
              and synced across your devices. It still won’t appear on the live site until it’s public
              and published.
            </>
          ) : (
            <>
              This commits the page to your content repo, so it’s durable and synced across your
              devices — and <strong>visible to anyone who can read the repo</strong>. It still won’t
              appear on the live site until it’s public and published.
            </>
          )}
        </p>

        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="is-primary" onClick={onConfirm}>
            Back up
          </button>
        </div>
      </div>
    </div>
  );
}
