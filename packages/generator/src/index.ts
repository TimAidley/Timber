/**
 * @timber/generator — Timber's shared static-site generator core.
 *
 * One codebase, two entry points (SPEC §6): imported by the app for live preview
 * and by the Node CLI for CI builds, version-pinned together so preview ≡ build.
 * Everything exported here is pure and isomorphic — no `fs`, DOM, or framework.
 */
export { renderPage } from './render.js';
export { renderMarkdown } from './markdown.js';
export { parseFrontMatter } from './frontmatter.js';
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
