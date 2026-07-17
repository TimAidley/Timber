import { useState } from 'react';
import type { ContentObject } from '@timber/content';

interface AddTranslationDialogProps {
  /** The object being translated (the source language variant). */
  object: ContentObject;
  /** Languages that don't yet have a variant in this translation group (the choices). */
  missingLanguages: string[];
  /** Languages already present in the group (shown for context). */
  existingLanguages: string[];
  onClose: () => void;
  onAdd: (targetLang: string) => void;
}

/**
 * Add a translation of an object (SPEC §5 → Multilingual). Pick a language that doesn't
 * yet exist in this translation group; the editor duplicates the object as a **draft** in
 * that language — same fields + body + copied assets, a fresh id, the shared translation
 * key — for the author to translate in place. The dialog only offers the *missing*
 * languages, so it doubles as this object's translation-coverage view.
 */
export function AddTranslationDialog({
  object,
  missingLanguages,
  existingLanguages,
  onClose,
  onAdd,
}: AddTranslationDialogProps): React.JSX.Element {
  const [lang, setLang] = useState(missingLanguages[0] ?? '');

  return (
    <div className="modal" role="dialog" aria-label="Add translation">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>Translate “{String(object.data.title ?? object.slug)}”</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="publish__summary">
          Creates a draft copy in the chosen language — same content to translate in place,
          linked as a translation of this page. Assets carry over automatically.
        </p>

        {existingLanguages.length > 0 ? (
          <p className="rename__preview">
            Already translated: {existingLanguages.map((l) => l.toUpperCase()).join(', ')}
          </p>
        ) : null}

        <label className="publish__message">
          Language
          <select autoFocus value={lang} onChange={(e) => setLang(e.target.value)}>
            {missingLanguages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <p className="rename__preview">
          New path: <code>content/{object.type}/{lang || '…'}/{object.slug}/index.md</code>
        </p>

        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={!lang}
            onClick={() => onAdd(lang)}
          >
            Add translation
          </button>
        </div>
      </div>
    </div>
  );
}
