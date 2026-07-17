import { useEffect, useState } from 'react';
import type { FieldSchema } from '@timber/content';

/** One reference-picker option: an object's id and a human label (its title). */
export interface ReferenceOption {
  id: string;
  label: string;
}

export interface WidgetProps {
  fieldKey: string;
  field: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/** Split a comma-separated string into trimmed, non-empty tags. */
function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Comma-separated tags input (SPEC §8 multi-select). The **parsed array** is the model
 * value, but the text box keeps its **own raw string** while you type. Deriving the box's
 * value from the parsed array on every keystroke (the old bug) stripped the separator you
 * were mid-typing — `en,` re-parsed to `['en']` and rendered back as `en`, so a comma or a
 * trailing space could never survive. The raw text is re-seeded from the model only when
 * the value changes from **outside** (e.g. switching objects), never from our own edits.
 */
function TagsField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
}): React.JSX.Element {
  const [text, setText] = useState(() =>
    (Array.isArray(value) ? (value as unknown[]).map(asString) : []).join(', '),
  );

  // Re-seed the text only on an external value change: if the incoming array no longer
  // matches what our current text parses to, adopt it. Our own edits already parse to the
  // value we emitted, so this is a no-op for them (no clobbering the separator being typed).
  useEffect(() => {
    const ext = Array.isArray(value) ? (value as unknown[]).map(asString) : [];
    setText((cur) => (sameTags(ext, parseTags(cur)) ? cur : ext.join(', ')));
  }, [value]);

  return (
    <input
      id={id}
      type="text"
      value={text}
      placeholder="comma, separated, tags"
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseTags(e.target.value));
      }}
    />
  );
}

/**
 * A schema-driven widget: one control per {@link FieldSchema} kind (SPEC §8). This
 * covers the plain kinds; `image`, `video`, and `reference` have dedicated
 * components ({@link ReferenceField} is the search-and-pick picker) that
 * {@link SchemaForm} dispatches to before reaching here.
 */
export function FieldWidget({
  fieldKey,
  field,
  value,
  onChange,
}: WidgetProps): React.JSX.Element {
  const id = `field-${fieldKey}`;

  switch (field.type) {
    case 'multiline':
      return (
        <textarea
          id={id}
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      );

    case 'number':
      return (
        <input
          id={id}
          type="number"
          value={value === undefined || value === null ? '' : Number(value)}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)}
        />
      );

    case 'boolean':
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );

    case 'date':
      return (
        <input id={id} type="date" value={asString(value)} onChange={(e) => onChange(e.target.value)} />
      );

    case 'datetime':
      return (
        <input
          id={id}
          type="datetime-local"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'enum':
      return (
        <select id={id} value={asString(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case 'color': {
      // Native picker; an unset field shows "theme default" and stays undefined until the
      // author picks (so it doesn't force a value), with Clear to return to the default.
      const current = asString(value);
      return (
        <span className="color-field">
          <input
            id={id}
            type="color"
            value={current || '#000000'}
            onChange={(e) => onChange(e.target.value)}
          />
          {current ? (
            <>
              <code>{current}</code>
              <button
                type="button"
                className="color-field__clear"
                onClick={() => onChange(undefined)}
              >
                Clear
              </button>
            </>
          ) : (
            <span className="color-field__hint">theme default</span>
          )}
        </span>
      );
    }

    case 'tags':
      return <TagsField id={id} value={value} onChange={onChange} />;

    case 'video':
      return (
        <input
          id={id}
          type="url"
          value={asString(value)}
          placeholder="https://youtube.com/watch?v=…"
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'image':
      // Slice 4b replaces this with the in-browser upload/processing widget.
      return (
        <input
          id={id}
          type="text"
          value={asString(value)}
          placeholder="assets/… (upload pipeline: Slice 4b)"
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'text':
    default:
      return (
        <input id={id} type="text" value={asString(value)} onChange={(e) => onChange(e.target.value)} />
      );
  }
}
