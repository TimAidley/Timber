/**
 * @timber/generator — Timber's shared static-site generator core.
 *
 * One codebase, two entry points (SPEC §6): imported by the app for live preview
 * and by the Node CLI for CI builds, version-pinned together so preview ≡ build.
 * Everything exported here is pure and isomorphic — no `fs`, DOM, or framework.
 */
export { renderPage } from './render.js';
export { renderMarkdown } from './markdown.js';
// Listing-page excerpts (SPEC §6): a theme can't reach another object's body, so the
// "opening of each post" a blog home page shows is computed here and carried on
// `collections`. See @timber/content's `attachExcerpts`.
export { renderExcerpt, splitExcerpt } from './excerpt.js';
// Body-link rewriting: base path for root-relative refs, object URL for relative ones.
export { rebaseHtml } from './links.js';
export type { RebaseOptions } from './links.js';
export { parseFrontMatter } from './frontmatter.js';
// The on-disk `index.md` format (SPEC §4). Any producer of content — the editor, an
// importer, a migration script — must write through these so it matches what the editor
// would write; see site-template/AUTHORING.md and `timber fmt`.
export {
  serializeDocument,
  formatDocument,
  isCanonicalDocument,
} from './document.js';
export { createEngine, engine, SafeHtml } from './liquid.js';
export { buildClock } from './clock.js';
export type { Clock } from './clock.js';

export type {
  FrontMatter,
  ParsedDocument,
  RenderPageInput,
  SiteContext,
  CollectionsContext,
  TemplateMap,
} from './types.js';
export type { FileSource, OutputSink } from './io.js';
