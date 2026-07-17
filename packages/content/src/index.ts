/**
 * @timber/content — Timber's content model: schemas, collection/singleton types,
 * the id→object index, reference resolution, and tolerant validation (SPEC §5).
 *
 * Pure and isomorphic (no fs/DOM; builds with no @types/node). Operates on an
 * in-memory RepoSnapshot assembled up front — the Node CLI builds it by walking
 * disk, the browser (Phase 4) from RepoClient.loadTree.
 */
export { loadSchemas, SchemaError } from './schema.js';
export { assembleContent } from './assemble.js';
export { Validator } from './validate.js';
export {
  resolveReference,
  detectDanglingReferences,
  referrersTo,
  urlFor,
  translationsOf,
} from './references.js';
export type { Translation } from './references.js';
export { assembleCollections } from './collections.js';
export type { Collections, CollectionEntry } from './collections.js';
export { slugify, uniqueSlug } from './identity.js';
export { redirectStubHtml, aliasUrls } from './redirects.js';
export { isPublic, canPublish, resolvePublic, withPublic } from './visibility.js';
export { FIELD_KINDS, isFieldKind, fieldToJsonSchema } from './fields.js';
export { parseVideoUrl } from './video.js';
export type { VideoRef } from './video.js';
export { validateFigureBlocks } from './figures.js';
export { siteContext, pageSeo, buildSitemap, buildRobots, hreflangAlternates } from './seo.js';
export type { SiteContext, PageSeo, HreflangAlternate } from './seo.js';
export { loadNavigation } from './navigation.js';
export type { NavItem } from './navigation.js';

export type {
  FieldKind,
  FieldSchema,
  ContentTypeKind,
  ContentTypeSchema,
  ContentObject,
  RepoSnapshot,
  FieldError,
  ValidationResult,
  ModelError,
  ContentModel,
} from './types.js';
