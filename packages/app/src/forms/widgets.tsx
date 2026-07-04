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
  /** Candidate targets for a `reference` field (objects of its referenceType). */
  referenceOptions?: ReferenceOption[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/**
 * A schema-driven widget: one control per {@link FieldSchema} kind (SPEC §8 — "a
 * date field renders a date picker, a reference field renders the search-and-pick
 * control…"). This is the minimal set for the de-risk slice; `image` renders a
 * plain path input for now (the upload pipeline is Slice 4b), and `reference` is a
 * simple select rather than the eventual searchable picker.
 */
export function FieldWidget({
  fieldKey,
  field,
  value,
  onChange,
  referenceOptions = [],
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

    case 'tags': {
      const tags = Array.isArray(value) ? (value as unknown[]).map(asString) : [];
      return (
        <input
          id={id}
          type="text"
          value={tags.join(', ')}
          placeholder="comma, separated, tags"
          onChange={(e) => {
            const next = e.target.value
              .split(',')
              .map((t) => t.trim())
              .filter((t) => t.length > 0);
            onChange(next);
          }}
        />
      );
    }

    case 'reference':
      return (
        <select id={id} value={asString(value)} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">— none —</option>
          {referenceOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label} ({opt.id})
            </option>
          ))}
        </select>
      );

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
