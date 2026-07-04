import type { FrontMatter } from '@timber/generator';

/**
 * The v1 field-type vocabulary (SPEC §5). This is the *authored* vocabulary —
 * schema files speak in these kinds; the validator translates them to JSON Schema
 * internally (see fields.ts), so authors never see JSON Schema.
 *
 * The Markdown body is NOT a field kind: it is the always-available, optional
 * `index.md` body, gated by `ContentTypeSchema.hasBody`.
 */
export type FieldKind =
  | 'text' // single-line string
  | 'multiline' // multi-line plain text
  | 'number'
  | 'boolean'
  | 'date' // calendar date (YYYY-MM-DD)
  | 'datetime' // date + time (ISO-8601)
  | 'enum' // single-select from `options`
  | 'tags' // multi-select: array of strings
  | 'image' // path to a colocated/asset image
  | 'reference' // stores a target object's id, displays its title
  | 'video'; // external URL, provider-allowlisted

/** One field's declaration within a content type's schema. */
export interface FieldSchema {
  type: FieldKind;
  /** Whether the field must be present and non-empty. Defaults to false. */
  required?: boolean;
  /** Editor-facing label (defaults to the field key). */
  label?: string;
  /** `enum`: the allowed values. */
  options?: string[];
  /** `reference`: the content type this field points to (enables type-checked refs). */
  referenceType?: string;
  /** `text`/`multiline`: max length and/or a validation regex. */
  maxLength?: number;
  pattern?: string;
  /** `number`: inclusive bounds. */
  min?: number;
  max?: number;
}

export type ContentTypeKind = 'collection' | 'singleton';

/** A content type declaration, loaded from `config/schemas/<name>.yml`. */
export interface ContentTypeSchema {
  name: string;
  kind: ContentTypeKind;
  /** URL pattern override; defaults to `/{type}/{slug}/`. */
  urlPattern?: string;
  /** Whether objects of this type carry a Markdown body. Defaults to true. */
  hasBody?: boolean;
  /**
   * Whether objects of this type render as pages (SPEC §13). Defaults to true; a
   * config singleton like `settings` sets `page: false` so the build reads it for
   * site context but never emits an HTML page for it.
   */
  page?: boolean;
  fields: Record<string, FieldSchema>;
}

/** One assembled content object (one `index.md` bundle). */
export interface ContentObject {
  /** Content type name (e.g. `events`). */
  type: string;
  kind: ContentTypeKind;
  /** Immutable identity from front matter, if present (SPEC §5). */
  id?: string;
  /** Folder name for collections; the type name for singletons. */
  slug: string;
  /** Repo-relative path to the object's `index.md`. */
  path: string;
  /** Parsed front-matter data. */
  data: FrontMatter;
  /** Markdown body (empty string when the type has no body). */
  body: string;
  /** Resolved visibility — draft (false) by default when the `public` key is absent. */
  public: boolean;
}

/** An in-memory snapshot of a repo's text files, keyed by repo-relative path. */
export type RepoSnapshot = Map<string, string>;

/** A single validation problem, tied to a field where applicable. */
export interface FieldError {
  /** Field key, or `undefined` for object-level problems (e.g. a bad body). */
  field?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
}

/** A model-level problem that spans objects (duplicate id, dangling ref, cardinality). */
export interface ModelError {
  kind: 'duplicate-id' | 'dangling-reference' | 'cardinality' | 'unknown-type';
  message: string;
  /** Path(s) of the object(s) involved. */
  paths: string[];
}

/** The assembled, in-memory content model — built up-front by walking every object. */
export interface ContentModel {
  schemas: Map<string, ContentTypeSchema>;
  objects: ContentObject[];
  /** id → object index; powers reference resolution and dangling detection (SPEC §5). */
  byId: Map<string, ContentObject>;
  /** Structural problems found during assembly. */
  errors: ModelError[];
}
