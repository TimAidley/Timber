import type { ContentModel, ContentTypeSchema } from '@timber/content';
import type { FrontMatter } from '@timber/generator';
import { FieldWidget, type ReferenceOption } from './widgets.js';

interface SchemaFormProps {
  schema: ContentTypeSchema;
  data: FrontMatter;
  model: ContentModel;
  onChange: (key: string, value: unknown) => void;
}

/** Objects of a given type, as reference-picker options (id + title). */
function referenceOptionsFor(model: ContentModel, referenceType: string | undefined): ReferenceOption[] {
  if (!referenceType) return [];
  return model.objects
    .filter((o) => o.type === referenceType && o.id)
    .map((o) => ({ id: o.id as string, label: String(o.data.title ?? o.slug) }));
}

/**
 * Render a content type's front matter as a structured form (SPEC §8): one labeled
 * widget per declared field, driven entirely by the schema — nothing is hardcoded
 * per type. The Markdown body is handled separately by the Milkdown editor.
 */
export function SchemaForm({ schema, data, model, onChange }: SchemaFormProps): React.JSX.Element {
  return (
    <div className="schema-form">
      {Object.entries(schema.fields).map(([key, field]) => (
        <div className="schema-form__row" key={key}>
          <label className="schema-form__label" htmlFor={`field-${key}`}>
            {field.label ?? key}
            {field.required ? <span className="schema-form__required"> *</span> : null}
          </label>
          <FieldWidget
            fieldKey={key}
            field={field}
            value={data[key]}
            onChange={(value) => onChange(key, value)}
            referenceOptions={referenceOptionsFor(model, field.referenceType)}
          />
        </div>
      ))}
    </div>
  );
}
