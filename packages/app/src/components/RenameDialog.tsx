import { useState } from 'react';
import { slugify, type ContentObject } from '@timber/content';

interface RenameDialogProps {
  object: ContentObject;
  /** Slugs already used by other objects of the same type (collision guard). */
  takenSlugs: Set<string>;
  onClose: () => void;
  onRename: (newSlug: string) => void;
}

/**
 * Rename an object's slug (SPEC §5). The slug drives the URL; references store the
 * immutable `id`, so renaming never breaks a link — the old URL just gets a redirect
 * stub (emitted at build from an appended `aliases` entry). The new slug must be
 * non-empty and unique within the type.
 */
export function RenameDialog({ object, takenSlugs, onClose, onRename }: RenameDialogProps): React.JSX.Element {
  const [value, setValue] = useState(object.slug);
  const slug = slugify(value);

  const unchanged = slug === object.slug;
  const collides = slug !== object.slug && takenSlugs.has(slug);
  const invalid = slug.length === 0 || collides;

  return (
    <div className="modal" role="dialog" aria-label="Rename object">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>Rename “{String(object.data.title ?? object.slug)}”</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="publish__summary">
          Changes the slug (and URL). References keep working — the old URL redirects to the new one.
        </p>

        <label className="publish__message">
          Slug
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !invalid && !unchanged) onRename(slug);
            }}
          />
        </label>
        <p className="rename__preview">
          New path: <code>content/{object.type}/{slug || '…'}/index.md</code>
        </p>
        {collides ? <p className="publish__error">Another {object.type} already uses that slug.</p> : null}

        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="is-primary" disabled={invalid || unchanged} onClick={() => onRename(slug)}>
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
