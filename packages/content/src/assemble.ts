import { parseFrontMatter } from '@timber/generator';
import { resolvePublic } from './visibility.js';
import type {
  ContentModel,
  ContentObject,
  ContentTypeSchema,
  ModelError,
  RepoSnapshot,
} from './types.js';

// content/<type>/index.md                   -> singleton (no slug, no lang)
// content/<type>/<slug>/index.md            -> collection object (slug = <slug>)
// content/<type>/<lang>/<slug>/index.md     -> collection object in language <lang>
// The two optional segments are captured greedily: a lone segment is the slug (group 2);
// two segments are (lang, slug) (groups 2, 3). Slugs are single path components, so depth
// disambiguates cleanly — no nested collections exist to make three levels ambiguous.
const OBJECT_PATH = /^content\/([^/]+)\/(?:([^/]+)\/)?(?:([^/]+)\/)?index\.md$/;

/** The i18n settings read from the site's singleton (SPEC §5 → Multilingual). */
interface I18nConfig {
  /** Declared BCP-47 codes; empty means the site is single-language (i18n off). */
  languages: string[];
  /** The default language — an explicit `defaultLanguage`, else the first declared. */
  defaultLanguage: string;
}

/**
 * Read the site's multilingual config from the settings singleton — the first
 * singleton bundle whose front matter declares a non-empty `languages` list. i18n is
 * **opt-in**: with no such declaration the site is single-language, `languages` is
 * empty, and objects get no `lang` (so URLs stay unprefixed exactly as before).
 */
function readI18nConfig(
  snapshot: RepoSnapshot,
  schemas: Map<string, ContentTypeSchema>,
): I18nConfig {
  for (const [type, schema] of schemas) {
    if (schema.kind !== 'singleton') continue;
    const contents = snapshot.get(`content/${type}/index.md`);
    if (contents === undefined) continue;
    const { data } = parseFrontMatter(contents);
    const languages = Array.isArray(data.languages)
      ? data.languages.filter((l): l is string => typeof l === 'string' && l.length > 0)
      : [];
    if (languages.length === 0) continue;
    const declared = data.defaultLanguage;
    const defaultLanguage =
      typeof declared === 'string' && declared.length > 0 ? declared : languages[0]!;
    return { languages, defaultLanguage };
  }
  return { languages: [], defaultLanguage: '' };
}

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
  const byTranslation = new Map<string, Map<string, ContentObject>>();
  const errors: ModelError[] = [];

  const { languages, defaultLanguage } = readI18nConfig(snapshot, schemas);
  const i18nEnabled = languages.length > 0;

  for (const [path, contents] of snapshot) {
    const match = OBJECT_PATH.exec(path);
    if (!match) continue;

    const type = match[1]!;
    // A lone middle segment is the slug; two segments are (lang, slug).
    const pathLang = match[3] !== undefined ? match[2] : undefined;
    const slugSegment = match[3] ?? match[2];
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

    // Language (SPEC §5 → Multilingual): path segment is authoritative, then a
    // front-matter `lang`, then the site default — but only when i18n is enabled, so a
    // single-language site keeps every object `lang`-less and every URL unprefixed.
    // Singletons (site settings) are language-neutral and never carry a `lang`.
    if (schema.kind === 'collection') {
      const explicitLang =
        pathLang ?? (typeof data.lang === 'string' && data.lang ? data.lang : undefined);
      const lang = explicitLang ?? (i18nEnabled ? defaultLanguage : undefined);
      if (lang !== undefined) object.lang = lang;
      if (i18nEnabled && explicitLang && !languages.includes(explicitLang)) {
        errors.push({
          kind: 'unknown-language',
          message: `"${path}" declares language "${explicitLang}", not in the site's languages [${languages.join(', ')}]`,
          paths: [path],
        });
      }
    }

    if (typeof data.translationKey === 'string' && data.translationKey) {
      object.translationKey = data.translationKey;
    }

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

    if (object.translationKey) {
      const langKey = object.lang ?? '';
      const group = byTranslation.get(object.translationKey) ?? new Map();
      const existing = group.get(langKey);
      if (existing) {
        errors.push({
          kind: 'translation-conflict',
          message: `translationKey "${object.translationKey}" has two objects for language "${langKey || '(none)'}"`,
          paths: [existing.path, object.path],
        });
      } else {
        group.set(langKey, object);
      }
      byTranslation.set(object.translationKey, group);
    }
  }

  return { schemas, objects, byId, byTranslation, errors };
}
