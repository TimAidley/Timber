import type { ContentTypeKind } from '@timber/content';

/**
 * Helpers for **creating a new content type** from the advanced area (SPEC §8). A
 * content type is just a `config/schemas/<name>.yml` file, so "create a type" means
 * "author a starter schema and commit it through the same edit-preview-commit loop as
 * every other advanced file". These are the pure bits (name validation + YAML
 * generation) kept out of the React dialog so they're unit-testable.
 */

export interface NewTypeOptions {
  /** The type name — also the schema filename and the `content/<name>/…` path segment. */
  name: string;
  kind: ContentTypeKind;
  /** Whether objects of this type render as their own page (SPEC §13). */
  page: boolean;
  /** Whether objects carry a Markdown body. */
  hasBody: boolean;
}

/** Type names double as path segments + reference targets, so keep them slug-safe. */
const NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * The defaults a chosen kind pre-fills in the dialog. A **collection** (events,
 * people…) is a set of pages with bodies; a **singleton** defaults to the common
 * config case (`settings`-style): read for site context, no page, no body. Either
 * default can be overridden before creating.
 */
export function defaultsForKind(kind: ContentTypeKind): {
  page: boolean;
  hasBody: boolean;
} {
  return kind === 'collection'
    ? { page: true, hasBody: true }
    : { page: false, hasBody: false };
}

/** Repo path for a type's schema file. */
export function schemaPathFor(name: string): string {
  return `config/schemas/${name}.yml`;
}

/** The type name behind a `config/schemas/<name>.yml` path (for collision checks). */
export function schemaNameFromPath(path: string): string | undefined {
  return /^config\/schemas\/([^/]+)\.ya?ml$/.exec(path)?.[1];
}

/**
 * Validate a proposed type name, returning a human-readable error or `null` when it's
 * usable. Guards the slug shape and rejects names already taken by another type.
 */
export function validateTypeName(
  name: string,
  existing: ReadonlySet<string>,
): string | null {
  const n = name.trim();
  if (!n) return 'Enter a name for the type.';
  if (!NAME_RE.test(n)) {
    return 'Use lowercase letters, numbers and hyphens, starting with a letter — e.g. “events”.';
  }
  if (existing.has(n)) return `A type named “${n}” already exists.`;
  return null;
}

/**
 * Generate a **starter schema** for a new type: the chosen kind/flags plus a single
 * `title` field so the type is immediately valid and usable. `hasBody` is always
 * emitted (it's the knob authors most often flip); `page` only when `false`, since it
 * defaults to `true` in the generator. A `title` is `required` for anything that
 * renders as a page — a page needs a heading — matching the shipped `pages.yml`.
 */
export function buildSchemaYaml(opts: NewTypeOptions): string {
  const lines = [
    `# “${opts.name}” content type — edit the fields below.`,
    `# See the YAML cheat sheet under the editor for the available field types.`,
    `kind: ${opts.kind}`,
    `hasBody: ${opts.hasBody}`,
  ];
  if (!opts.page) lines.push('page: false');
  lines.push('fields:', '  title:', '    type: text');
  if (opts.page) lines.push('    required: true');
  return lines.join('\n') + '\n';
}
