import { useState } from 'react';
import type { ForeignChange } from '../state/foreignChanges.js';
import { PathDiff } from '../diff/PathDiff.js';
import type { RefTextClient } from '../diff/useRefText.js';

/** `content/events/fete/index.md` → `fete`; other files keep their path-ish name. */
function label(path: string): string {
  if (path.endsWith('/index.md')) return path.replace(/\/index\.md$/, '').split('/').pop() ?? path;
  return path.split('/').pop() ?? path;
}

interface ForeignChangesBannerProps {
  change: ForeignChange;
  onReview: () => void;
  onDismiss: () => void;
}

/**
 * "Someone else is writing to this branch" (SPEC §11). Two tabs editing different files
 * is now completely silent — the client absorbs the ref race — so this banner appears
 * only when it carries information: another writer moved the branch on, and possibly
 * touched something you're editing, in which case your next save overwrites theirs.
 *
 * A warning, not a merge UI: it names the files and shows what changed; what to do
 * about it stays the author's call.
 */
export function ForeignChangesBanner({ change, onReview, onDismiss }: ForeignChangesBannerProps): React.JSX.Element {
  const overlapping = change.paths.filter((p) => p.overlapping);
  const n = change.paths.length;
  return (
    <div className={`foreign-banner${overlapping.length > 0 ? ' foreign-banner--clash' : ''}`} role="status">
      <span className="foreign-banner__glyph" aria-hidden="true">
        {overlapping.length > 0 ? '⚠' : 'ℹ'}
      </span>
      <span className="foreign-banner__text">
        Another tab or device saved {n} {n === 1 ? 'change' : 'changes'} to this branch
        {overlapping.length > 0 ? (
          <>
            {' '}
            — including <strong>{overlapping.map((p) => label(p.path)).join(', ')}</strong>, which you’re also
            editing. Saving here will overwrite their version.
          </>
        ) : (
          <>. Your work isn’t affected — nothing you’re editing was touched.</>
        )}
      </span>
      <button type="button" className="foreign-banner__btn" onClick={onReview}>
        See what changed
      </button>
      <button type="button" className="foreign-banner__btn" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

interface ForeignChangesDialogProps {
  change: ForeignChange;
  client: RefTextClient;
  onClose: () => void;
}

/**
 * What the other writer actually changed, one expandable diff per file — their commit
 * against the tip we last agreed on. For a file you're also editing this is precisely
 * "the changes your next save will overwrite", which is the question the banner raises
 * and couldn't answer on its own.
 */
export function ForeignChangesDialog({ change, client, onClose }: ForeignChangesDialogProps): React.JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(
    // Start with the clashing files expanded — they're why the dialog was opened.
    () => new Set(change.paths.filter((p) => p.overlapping).map((p) => p.path)),
  );
  const toggle = (path: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="modal" role="dialog" aria-label="Changes from another editor">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>Changes from another tab or device</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="foreign-dialog__intro">
          Committed to <code>{change.sha.slice(0, 7)}</code> since you loaded. Files marked{' '}
          <span className="foreign-dialog__tag foreign-dialog__tag--clash">also editing here</span> will be
          overwritten by your next save — copy anything you want to keep before saving.
        </p>

        <ul className="foreign-dialog__list">
          {change.paths.map((p) => {
            const expanded = open.has(p.path);
            return (
              <li key={p.path} className="foreign-dialog__item">
                <button
                  type="button"
                  className="foreign-dialog__row"
                  aria-expanded={expanded}
                  onClick={() => toggle(p.path)}
                >
                  <span className="foreign-dialog__chevron" aria-hidden="true">
                    {expanded ? '▾' : '▸'}
                  </span>
                  <span className="foreign-dialog__title">{label(p.path)}</span>
                  <span className="foreign-dialog__status">{p.status}</span>
                  {p.overlapping ? (
                    <span className="foreign-dialog__tag foreign-dialog__tag--clash">also editing here</span>
                  ) : null}
                </button>
                <code className="foreign-dialog__path">{p.path}</code>
                {expanded ? (
                  <div className="foreign-dialog__diff">
                    <PathDiff
                      client={client}
                      path={p.path}
                      baseRef={change.baseSha}
                      headRef={change.sha}
                      bustKey={change.sha}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
