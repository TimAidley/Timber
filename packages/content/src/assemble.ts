import { parseFrontMatter } from '@timber/generator';
import { resolvePublic } from './visibility.js';
import type {
  ContentModel,
  ContentObject,
  ContentTypeSchema,
  ModelError,
  RepoSnapshot,
} from './types.js';

// content/<type>/index.md            -> singleton (no slug)
// content/<type>/<slug>/index.md     -> collection object (slug = <slug>)
const OBJECT_PATH = /^content\/([^/]+)\/(?:([^/]+)\/)?index\.md$/;

/**
 * Assemble the in-memory content model by walking every object bundle up front
 * (SPEC §5/§6): split front matter, derive slug + visibility, and build the
 * id→object index. Structural problems (unknown type, wrong bundle shape for the
 * declared kind, duplicate ids) are collected as `model.errors` rather than thrown,
 * so one bad object never hides the rest.
 */
export function assembleContent(
  snapshot: RepoSnapshot,
  schemas: Map<string, ContentTypeSchema>,
): ContentModel {
  const objects: ContentObject[] = [];
  const byId = new Map<string, ContentObject>();
  const errors: ModelError[] = [];

  for (const [path, contents] of snapshot) {
    const match = OBJECT_PATH.exec(path);
    if (!match) continue;

    const type = match[1]!;
    const slugSegment = match[2];
    const schema = schemas.get(type);

    if (!schema) {
      errors.push({
        kind: 'unknown-type',
        message: `object at "${path}" has no schema for type "${type}"`,
        paths: [path],
      });
      continue;
    }

    // The on-disk shape must match the declared kind.
    const shapedAsCollection = slugSegment !== undefined;
    if (schema.kind === 'collection' && !shapedAsCollection) {
      errors.push({
        kind: 'cardinality',
        message: `collection type "${type}" object must live at content/${type}/<slug>/index.md, not "${path}"`,
        paths: [path],
      });
      continue;
    }
    if (schema.kind === 'singleton' && shapedAsCollection) {
      errors.push({
        kind: 'cardinality',
        message: `singleton type "${type}" must live at content/${type}/index.md, not "${path}"`,
        paths: [path],
      });
      continue;
    }

    const { data, body } = parseFrontMatter(contents);
    const object: ContentObject = {
      type,
      kind: schema.kind,
      slug: slugSegment ?? type,
      path,
      data,
      body: schema.hasBody === false ? '' : body,
      public: resolvePublic(data),
    };
    if (typeof data.id === 'string') object.id = data.id;

    objects.push(object);

    if (object.id) {
      const existing = byId.get(object.id);
      if (existing) {
        errors.push({
          kind: 'duplicate-id',
          message: `duplicate id "${object.id}"`,
          paths: [existing.path, object.path],
        });
      } else {
        byId.set(object.id, object);
      }
    }
  }

  return { schemas, objects, byId, errors };
}
