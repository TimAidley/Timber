import {
  parseObjectPath,
  urlFor,
  type ContentObject,
  type ContentTypeSchema,
  type ThemePaths,
} from '@timber/content';
import type { FrontMatter } from '@timber/generator';
import type { MoveEntry, TreeEntry } from '@timber/host';
import { schemaPathFor, validateTypeName } from './schemaTemplate.js';

/**
 * **Rename a content type** (SPEC §8) — the pure planning half. A type's name is woven
 * through the repo in several places, and a rename must move all of them together or
 * the site silently breaks (objects with no schema; references to a type that no longer
 * exists; a template that no longer matches). Given the working state, this computes
 * one **plan** the editor then executes through the shared autosave loop:
 *
 *   1. the schema file `config/schemas/<old>.yml` → `config/schemas/<new>.yml`;
 *   2. every bundle `content/<old>/**` → `content/<new>/**` (all three path shapes —
 *      singleton, collection, multilingual — since the type is the first segment of
 *      each), with bundle-relative front-matter values (image fields) repointed,
 *      colocated assets moved by blob SHA, and an **absolute-URL alias** appended so
 *      the old `/old/<slug>/` address redirects to the new one (`aliasUrls`);
 *   3. `referenceType: <old>` in every schema (this one included) → `<new>`;
 *   4. `paginate.collection: <old>` in any object's front matter → `<new>`;
 *   5. the per-type template `<templatesDir>/<old>.liquid` → `<new>.liquid`, in the
 *      active theme (whose text we hold, so a pending edit isn't lost) and in any other
 *      theme folder found in the tree (moved by blob SHA).
 *
 * What it deliberately does **not** rewrite — and instead reports as **warnings** — is
 * free text that merely *mentions* the type: `collections.<old>` / `site.<old>` loops in
 * templates and `/old/…` URLs typed into config or page bodies. Those are the author's
 * prose and code; a blind textual rewrite could as easily corrupt as fix them, so the
 * plan names them and leaves the edit to a human.
 *
 * Pure (no React, no IndexedDB, no network) so the whole mapping is unit-testable.
 */

export interface RenameTypeInput {
  oldName: string;
  newName: string;
  schemas: ReadonlyMap<string, ContentTypeSchema>;
  /** The live working objects — with any in-progress edit already substituted in. */
  objects: readonly ContentObject[];
  /** Object paths marked for deletion — left where they are (a deleted bundle stays deleted). */
  deletedPaths?: ReadonlySet<string>;
  /** The loaded branch's tree (colocated assets + templates in non-active themes). */
  treeEntries: readonly TreeEntry[];
  /** Advanced files (templates + config) with their *current* working text. */
  advancedFiles: readonly { path: string; kind: string; content: string }[];
  theme: ThemePaths;
}

/** One object bundle moving from the old type's folder to the new one. */
export interface ObjectMove {
  object: ContentObject;
  from: string;
  to: string;
  /** The rewritten front matter (repointed bundle paths + the redirect alias). */
  data: FrontMatter;
  body: string;
  /** Colocated assets, moved by reusing their blob SHAs (no re-upload). */
  moves: MoveEntry[];
}

/** An object of *another* type whose front matter mentions the old name (`paginate`). */
export interface ObjectRewrite {
  object: ContentObject;
  data: FrontMatter;
}

/** A raw file (schema/template) moving to a new path, carrying its current text. */
export interface FileMove {
  from: string;
  to: string;
  content: string;
}

export interface RenameTypePlan {
  oldName: string;
  newName: string;
  /** The schema file itself (its text with any self-`referenceType` rewritten). */
  schema: FileMove;
  /** Other schema files whose `referenceType` pointed at the old name. */
  schemaRewrites: { path: string; content: string }[];
  objectMoves: ObjectMove[];
  objectRewrites: ObjectRewrite[];
  /** Templates whose text we hold (the active theme): rewritten at the new path. */
  templateMoves: FileMove[];
  /** Templates in other theme folders: moved by blob SHA. */
  templateShaMoves: MoveEntry[];
  /** Places that mention the old name but were left for a human to check. */
  warnings: string[];
}

/**
 * Validate a proposed new name for an existing type: the same slug rules as creation,
 * rejecting the current name (a no-op) and any name already in use.
 */
export function validateRename(
  oldName: string,
  newName: string,
  existing: ReadonlySet<string>,
): string | null {
  const n = newName.trim();
  if (n === oldName) return 'That is the type’s current name.';
  return validateTypeName(n, existing);
}

/** Rewrite `referenceType: <old>` (bare or quoted) to the new name in a schema's YAML. */
export function rewriteReferenceType(
  yaml: string,
  oldName: string,
  newName: string,
): string {
  const re = new RegExp(
    `^(\\s*referenceType:\\s*)(['"]?)${escapeRe(oldName)}\\2(\\s*(?:#.*)?)$`,
    'gm',
  );
  return yaml.replace(re, `$1$2${newName}$2$3`);
}

/**
 * Rewrite one object's front matter for a type rename. Bundle-relative string values
 * (`content/<old>/<slug>/photo.webp`) are repointed into the new folder; a
 * `paginate.collection` naming the old type is renamed; and, when `alias` is given,
 * it's appended to `aliases` (the object's old absolute URL, so the build emits a
 * redirect stub there — SPEC §5). Returns the same reference when nothing changed.
 */
export function rewriteFrontMatter(
  data: FrontMatter,
  oldDir: string | undefined,
  newDir: string | undefined,
  oldName: string,
  newName: string,
  alias?: string,
): FrontMatter {
  let changed = false;
  const out: FrontMatter = {};
  for (const [k, v] of Object.entries(data)) {
    if (oldDir && newDir && typeof v === 'string' && v.startsWith(`${oldDir}/`)) {
      out[k] = `${newDir}/${v.slice(oldDir.length + 1)}`;
      changed = true;
    } else if (k === 'paginate' && isRecord(v) && v.collection === oldName) {
      out[k] = { ...v, collection: newName };
      changed = true;
    } else {
      out[k] = v;
    }
  }
  if (alias) {
    const prev = Array.isArray(out.aliases)
      ? out.aliases.filter((a): a is string => typeof a === 'string')
      : [];
    if (!prev.includes(alias)) {
      out.aliases = [...prev, alias];
      changed = true;
    }
  }
  return changed ? out : data;
}

/** The bundle directory of an object's `index.md` path (`content/events/fete`). */
function bundleDir(path: string): string {
  return path.replace(/\/index\.md$/, '');
}

/** Swap the type segment of any `content/<old>/…` path. */
function retype(path: string, oldName: string, newName: string): string {
  return `content/${newName}/${path.slice(`content/${oldName}/`.length)}`;
}

/** Compute the plan. Throws if the new name is invalid (callers validate first). */
export function planTypeRename(input: RenameTypeInput): RenameTypePlan {
  const { oldName, newName, schemas, objects, treeEntries, advancedFiles, theme } = input;
  const deleted = input.deletedPaths ?? new Set<string>();
  const error = validateRename(oldName, newName, new Set(schemas.keys()));
  if (error) throw new Error(error);
  const oldSchema = schemas.get(oldName);
  if (!oldSchema) throw new Error(`No schema for type "${oldName}".`);

  const textOf = new Map(advancedFiles.map((f) => [f.path, f.content] as const));
  const blobs = treeEntries.filter((e) => e.type === 'blob');

  // 1 + 3. The schema file and every other schema's referenceType.
  const oldSchemaPath = schemaPathFor(oldName);
  const schemaText =
    textOf.get(oldSchemaPath) ?? textOf.get(`config/schemas/${oldName}.yaml`) ?? '';
  const schema: FileMove = {
    from: textOf.has(oldSchemaPath) ? oldSchemaPath : `config/schemas/${oldName}.yaml`,
    to: schemaPathFor(newName),
    content: rewriteReferenceType(schemaText, oldName, newName),
  };
  const schemaRewrites: { path: string; content: string }[] = [];
  for (const f of advancedFiles) {
    if (f.kind !== 'schema' || f.path === schema.from) continue;
    const next = rewriteReferenceType(f.content, oldName, newName);
    if (next !== f.content) schemaRewrites.push({ path: f.path, content: next });
  }

  // 2 + 4. Objects: move the old type's bundles; rewrite paginate blocks elsewhere.
  const objectMoves: ObjectMove[] = [];
  const objectRewrites: ObjectRewrite[] = [];
  for (const object of objects) {
    if (deleted.has(object.path)) continue;
    const parsed = parseObjectPath(object.path);
    if (parsed?.type !== oldName) {
      const data = rewriteFrontMatter(
        object.data,
        undefined,
        undefined,
        oldName,
        newName,
      );
      if (data !== object.data) objectRewrites.push({ object, data });
      continue;
    }
    const from = object.path;
    const to = retype(from, oldName, newName);
    const oldDir = bundleDir(from);
    const newDir = bundleDir(to);
    // The old address, resolved exactly as the build did — with the old schema, since
    // the new one might carry the same pattern and yield a URL that no longer exists.
    const alias = oldSchema.page === false ? undefined : urlFor(object, oldSchema);
    const data = rewriteFrontMatter(object.data, oldDir, newDir, oldName, newName, alias);
    const moves = blobs
      .filter((e) => e.path.startsWith(`${oldDir}/`) && e.path !== from)
      .map((e) => ({
        from: e.path,
        to: `${newDir}/${e.path.slice(oldDir.length + 1)}`,
        sha: e.sha,
      }));
    objectMoves.push({
      object,
      from,
      to,
      data: data === object.data ? { ...data } : data,
      body: object.body,
      moves,
    });
  }

  // 5. Per-type templates: the active theme's by text, any other theme's by SHA.
  const templateMoves: FileMove[] = [];
  const templateShaMoves: MoveEntry[] = [];
  const activeOld = `${theme.templatesDir}/${oldName}.liquid`;
  if (textOf.has(activeOld)) {
    templateMoves.push({
      from: activeOld,
      to: `${theme.templatesDir}/${newName}.liquid`,
      content: textOf.get(activeOld)!,
    });
  }
  const templateRe = /^(themes\/[^/]+\/templates|templates)\/([^/]+)\.liquid$/;
  for (const e of blobs) {
    const m = templateRe.exec(e.path);
    if (!m || m[2] !== oldName || e.path === activeOld) continue;
    templateShaMoves.push({ from: e.path, to: `${m[1]}/${newName}.liquid`, sha: e.sha });
  }

  // Mentions we won't touch: report them.
  const warnings: string[] = [];
  const mentionRe = new RegExp(`\\b(?:collections|site)\\.${escapeRe(oldName)}\\b`);
  const urlRe = new RegExp(`(?:^|["'(\\s=])/${escapeRe(oldName)}/`);
  for (const f of advancedFiles) {
    if (f.kind === 'template' && mentionRe.test(f.content)) {
      warnings.push(
        `${f.path} loops over collections.${oldName} — change it to collections.${newName}.`,
      );
    } else if (f.kind === 'config' && urlRe.test(f.content)) {
      warnings.push(`${f.path} contains a /${oldName}/ URL — update it to /${newName}/.`);
    }
  }
  const linking = objects.filter(
    (o) =>
      !deleted.has(o.path) &&
      (urlRe.test(o.body) ||
        Object.values(o.data).some((v) => typeof v === 'string' && urlRe.test(v))),
  );
  if (linking.length > 0) {
    const names = linking
      .slice(0, 3)
      .map((o) => String(o.data.title ?? o.slug))
      .join(', ');
    const more = linking.length > 3 ? ` and ${linking.length - 3} more` : '';
    warnings.push(
      `${linking.length === 1 ? 'One page links' : `${linking.length} pages link`} to /${oldName}/… (${names}${more}). The old links will redirect, but you may want to update them.`,
    );
  }

  return {
    oldName,
    newName,
    schema,
    schemaRewrites,
    objectMoves,
    objectRewrites,
    templateMoves,
    templateShaMoves,
    warnings,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
