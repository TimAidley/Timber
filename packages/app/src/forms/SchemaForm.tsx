import type { ContentModel, ContentTypeSchema } from '@timber/content';
import type { FrontMatter } from '@timber/generator';
import { FieldWidget, type ReferenceOption } from './widgets.js';
import { ImageField } from './ImageField.js';
import { VideoField } from './VideoField.js';
import type { AssetStore } from '../state/assets.js';

interface SchemaFormProps {
  schema: ContentTypeSchema;
  data: FrontMatter;
  model: ContentModel;
  onChange: (key: string, value: unknown) => void;
  /** Staging store for processed image bytes (image fields). */
  assetStore: AssetStore;
  /** The current object's bundle directory (for colocating image assets). */
  bundleDir: string;
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
 * widget per declared field, driven entirely by the schema. `image` and `video`
 * fields get first-class media widgets (upload/process pipeline; allowlist-validated
 * URL); the plain kinds go through the generic {@link FieldWidget}.
 */
export function SchemaForm({
  schema,
  data,
  model,
  onChange,
  assetStore,
  bundleDir,
}: SchemaFormProps): React.JSX.Element {
  return (
    <div className="schema-form">
      {Object.entries(schema.fields).map(([key, field]) => (
        <div className="schema-form__row" key={key}>
          <label className="schema-form__label" htmlFor={`field-${key}`}>
            {field.label ?? key}
            {field.required ? <span className="schema-form__required"> *</span> : null}
          </label>

          {field.type === 'image' ? (
            <ImageField
              fieldKey={key}
              value={data[key]}
              alt={data[`${key}Alt`]}
              onChangePath={(v) => onChange(key, v)}
              onChangeAlt={(v) => onChange(`${key}Alt`, v)}
              assetStore={assetStore}
              bundleDir={bundleDir}
            />
          ) : field.type === 'video' ? (
            <VideoField fieldKey={key} value={data[key]} onChange={(v) => onChange(key, v)} />
          ) : (
            <FieldWidget
              fieldKey={key}
              field={field}
              value={data[key]}
              onChange={(value) => onChange(key, value)}
              referenceOptions={referenceOptionsFor(model, field.referenceType)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
