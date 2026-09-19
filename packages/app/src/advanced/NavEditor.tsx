import { useMemo } from 'react';
import {
  parseNavigation,
  serializeNavigation,
  validateNavigation,
  type ContentModel,
  type NavEntry,
} from '@timber/content';
import { ReferenceField } from '../forms/ReferenceField.js';
import { moveEntry, pageOptions, targetKind, withRef, withTargetKind } from './navEdits.js';

interface NavEditorProps {
  /** The raw `config/navigation.yml` text (the advanced area's working value). */
  value: string;
  /** Receives the re-serialized YAML; the usual advanced validate/autosave path. */
  onChange: (next: string) => void;
  /** The working content model, for the page picker and dangling-ref warnings. */
  model: ContentModel;
}

/**
 * The site menu editor (SPEC §13) — the structured face of `config/navigation.yml`.
 *
 * Navigation is editorial: an ordered list an author curates, not something derived
 * from the content tree. But its `ref:` entries are object **ids**, and hand-authoring
 * a UUID into YAML is not an editing experience anyone should have. So each row picks
 * a page through the same search-by-title combobox a reference field uses — the id is
 * stored, the title is displayed, exactly as references work everywhere else.
 *
 * Writes go back out as canonical YAML through the ordinary advanced-file path, so the
 * raw **YAML** tab remains an escape hatch and nothing here bypasses validation or
 * autosave. Entries that won't render (a deleted target, a missing label) are flagged
 * inline but never block the save: a broken menu item is a missing link, not a broken
 * site, so the author fixes it on their own schedule.
 *
 * Deliberately flat — no submenus (SPEC §13). One level is what the default theme's
 * JS-free header can render accessibly.
 */
export function NavEditor({ value, onChange, model }: NavEditorProps): React.JSX.Element {
  const entries = useMemo(() => parseNavigation(value), [value]);
  const options = useMemo(() => pageOptions(model), [model]);
  const problems = useMemo(() => validateNavigation(entries, model), [entries, model]);
  const problemsByRow = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const p of problems) map.set(p.index, [...(map.get(p.index) ?? []), p.message]);
    return map;
  }, [problems]);

  const commit = (next: NavEntry[]): void => onChange(serializeNavigation(next));

  const update = (index: number, patch: NavEntry): void =>
    commit(entries.map((e, i) => (i === index ? patch : e)));

  const move = (index: number, delta: number): void => commit(moveEntry(entries, index, delta));

  const remove = (index: number): void => commit(entries.filter((_, i) => i !== index));

  return (
    <div className="nav-editor">
      <p className="advanced__hint">
        The links in your site’s header, in order. Each one points at a page or at any URL you
        type. This is the whole menu — pages aren’t added to it automatically.
      </p>

      {entries.length === 0 ? (
        <p className="nav-editor__empty">No menu links yet.</p>
      ) : (
        <ol className="nav-editor__list">
          {entries.map((entry, index) => {
            const kind = targetKind(entry);
            const rowProblems = problemsByRow.get(index) ?? [];
            return (
              <li key={index} className="nav-editor__row">
                <div className="nav-editor__fields">
                  <label className="nav-editor__label">
                    <span>Label</span>
                    <input
                      type="text"
                      value={entry.label}
                      placeholder="Menu text"
                      onChange={(e) => update(index, { ...entry, label: e.target.value })}
                    />
                  </label>

                  <div className="nav-editor__target">
                    <div
                      className="nav-editor__kind"
                      role="radiogroup"
                      aria-label={`Link target for entry ${index + 1}`}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={kind === 'page'}
                        className={`nav-editor__kind-btn${kind === 'page' ? ' is-active' : ''}`}
                        onClick={() => update(index, withTargetKind(entry, 'page'))}
                      >
                        Page
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={kind === 'url'}
                        className={`nav-editor__kind-btn${kind === 'url' ? ' is-active' : ''}`}
                        onClick={() => update(index, withTargetKind(entry, 'url'))}
                      >
                        URL
                      </button>
                    </div>

                    {kind === 'page' ? (
                      <ReferenceField
                        fieldKey={`nav-${index}`}
                        value={entry.ref}
                        options={options}
                        referenceType="pages"
                        onChange={(id) => update(index, withRef(entry, id))}
                      />
                    ) : (
                      <input
                        type="text"
                        className="nav-editor__url"
                        value={entry.url ?? ''}
                        placeholder="/blog/ or https://example.com"
                        aria-label={`URL for entry ${index + 1}`}
                        onChange={(e) => update(index, { label: entry.label, url: e.target.value })}
                      />
                    )}
                  </div>
                </div>

                <div className="nav-editor__actions">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${entry.label || `entry ${index + 1}`} up`}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === entries.length - 1}
                    aria-label={`Move ${entry.label || `entry ${index + 1}`} down`}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="nav-editor__remove"
                    onClick={() => remove(index)}
                    aria-label={`Remove ${entry.label || `entry ${index + 1}`}`}
                    title="Remove from the menu"
                  >
                    ✕
                  </button>
                </div>

                {rowProblems.length > 0 ? (
                  <ul className="nav-editor__problems">
                    {rowProblems.map((message, i) => (
                      <li key={i}>⚠ {message}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <div className="nav-editor__add">
        <button type="button" onClick={() => commit([...entries, { label: '' }])}>
          + Add a page
        </button>
        <button type="button" onClick={() => commit([...entries, { label: '', url: '' }])}>
          + Add a link
        </button>
      </div>
    </div>
  );
}
