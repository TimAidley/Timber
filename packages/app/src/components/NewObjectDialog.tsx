import { useState } from 'react';
import type { ContentModel, ContentTypeSchema } from '@timber/content';

interface NewObjectDialogProps {
  model: ContentModel;
  onClose: () => void;
  /** Chosen a collection type + title → create the object. */
  onCreate: (schema: ContentTypeSchema, title: string) => void;
}

/**
 * "New object" dialog (SPEC §5 object creation). Lists the **collection** types
 * (singletons have exactly one instance, so they're never created here) and takes a
 * title; the caller derives the id + unique slug and stages the draft bundle.
 */
export function NewObjectDialog({ model, onClose, onCreate }: NewObjectDialogProps): React.JSX.Element {
  const collections = [...model.schemas.values()].filter((s) => s.kind === 'collection');
  const [type, setType] = useState(collections[0]?.name ?? '');
  const [title, setTitle] = useState('');

  const schema = model.schemas.get(type);

  function submit(): void {
    if (!schema) return;
    onCreate(schema, title);
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
