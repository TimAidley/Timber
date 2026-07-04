import { useMemo, useState } from 'react';
import type { ReferenceOption } from './widgets.js';

interface ReferenceFieldProps {
  fieldKey: string;
  value: unknown;
  /** Candidate targets (objects of the field's referenceType), id + title. */
  options: ReferenceOption[];
  referenceType?: string | undefined;
  onChange: (id: string | undefined) => void;
}

/**
 * Case-insensitive search over reference options by title or id (SPEC §8:
 * "a reference field renders the search-and-pick control"). Pure so it's unit-
 * testable without a DOM; an empty query returns everything up to `limit`.
 */
export function filterReferenceOptions(
  options: ReferenceOption[],
  query: string,
  limit = 50,
): ReferenceOption[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
    : options;
  return matches.slice(0, limit);
}

/**
 * The `reference` field widget (SPEC §5/§8): references **store an object's id** but
 * **display its title**. Instead of a raw `<select>` (unusable once a type has many
 * objects), this is a search-and-pick combobox — type to filter by title, arrow/enter
 * or click to select, clear to unset. A stored id that no longer resolves (a deleted
 * or missing target) is surfaced as a dangling-reference warning rather than shown as
 * a blank, so the author can fix it before it blocks publishing.
 */
export function ReferenceField({ fieldKey, value, options, referenceType, onChange }: ReferenceFieldProps): React.JSX.Element {
  const id = typeof value === 'string' && value.length > 0 ? value : undefined;
  const selected = id ? options.find((o) => o.id === id) : undefined;
  const dangling = id !== undefined && !selected;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const matches = useMemo(() => filterReferenceOptions(options, query), [options, query]);
  const inputId = `field-${fieldKey}`;

  function pick(option: ReferenceOption): void {
    onChange(option.id);
    setQuery('');
    setOpen(false);
  }

  function clear(): void {
    onChange(undefined);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      const option = matches[highlight];
      if (open && option) {
        e.preventDefault();
        pick(option);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="reference-field">
      <div className="reference-field__control">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${inputId}-list`}
          autoComplete="off"
          placeholder={selected ? selected.label : `Search ${referenceType ?? 'objects'}…`}
          value={open ? query : (selected?.label ?? '')}
          onFocus={() => {
            setOpen(true);
            setQuery('');
            setHighlight(0);
          }}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
        />
        {id ? (
          <button type="button" className="reference-field__clear" aria-label="Clear reference" onMouseDown={(e) => e.preventDefault()} onClick={clear}>
            ✕
          </button>
        ) : null}
      </div>

      {dangling ? (
        <span className="reference-field__missing">⚠ references a missing object (<code>{id}</code>)</span>
      ) : null}

      {open ? (
        <ul className="reference-field__list" id={`${inputId}-list`} role="listbox">
          {matches.length === 0 ? (
            <li className="reference-field__empty">No matches</li>
          ) : (
            matches.map((opt, i) => (
              <li key={opt.id} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  className={`reference-field__option${i === highlight ? ' is-active' : ''}`}
                  // Prevent the input blur from firing before the click registers.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(opt)}
                >
                  <span className="reference-field__label">{opt.label}</span>
                  <span className="reference-field__id">{opt.id}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
