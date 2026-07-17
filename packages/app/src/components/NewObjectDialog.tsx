import { useState } from 'react';
import type { ContentModel, ContentTypeSchema } from '@timber/content';
import type { StorageLevel } from '../state/location.js';

interface NewObjectDialogProps {
  model: ContentModel;
  onClose: () => void;
  /** Chosen a collection type + title + storage level → create the object. */
  onCreate: (schema: ContentTypeSchema, title: string, storage: StorageLevel) => void;
  /**
   * Repo visibility (SPEC §5), for the "Back up" option's wording: `true` ⇒ "visible to
   * anyone", `false` ⇒ "visible to collaborators", `undefined` ⇒ neutral (unknown).
   */
  repoPublic?: boolean | undefined;
}

/**
 * "New object" dialog (SPEC §5 object creation). Lists the **collection** types
 * (singletons have exactly one instance, so they're never created here), takes a
 * title, and asks where to keep it — the **storage level** choice (SPEC §5/§8), made
 * up front so nothing reaches the host before the author decides. The caller derives
 * the id + unique slug and stages the draft bundle.
 */
export function NewObjectDialog({
  model,
  onClose,
  onCreate,
  repoPublic,
}: NewObjectDialogProps): React.JSX.Element {
  const collections = [...model.schemas.values()].filter((s) => s.kind === 'collection');
  const [type, setType] = useState(collections[0]?.name ?? '');
  const [title, setTitle] = useState('');
  const [storage, setStorage] = useState<StorageLevel>('backed-up');

  const schema = model.schemas.get(type);

  // How exposed "Back up" is, in plain words, keyed off repo visibility.
  const backedUpExposure =
    repoPublic === true
      ? 'visible to anyone who can see the repo'
      : repoPublic === false
        ? 'visible to your repo collaborators'
        : 'stored in the content repo';

  function submit(): void {
    if (!schema) return;
    onCreate(schema, title, storage);
  }

  return (
    <div className="modal" role="dialog" aria-label="New object">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>New object</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {collections.length === 0 ? (
          <p>No collection types are defined in this repo.</p>
        ) : (
          <>
            <label className="publish__message">
              Type
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {collections.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="publish__message">
              Title
              <input
                autoFocus
                value={title}
                placeholder="e.g. Summer Fête"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
              />
            </label>
            <fieldset className="new-object__storage">
              <legend>Where to keep it</legend>
              <label>
                <input
                  type="radio"
                  name="storage"
                  checked={storage === 'backed-up'}
                  onChange={() => setStorage('backed-up')}
                />
                <span>
                  <strong>Back up to the repo</strong>
                  <small>Durable and synced across your devices — {backedUpExposure}.</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="storage"
                  checked={storage === 'device'}
                  onChange={() => setStorage('device')}
                />
                <span>
                  <strong>Keep on this device</strong>
                  <small>
                    Private to this browser — <em>not backed up</em>; can be lost if you clear
                    site data or switch devices. Back it up later when you're ready.
                  </small>
                </span>
              </label>
            </fieldset>
            <div className="modal__actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="is-primary" disabled={!schema} onClick={submit}>
                Create
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
