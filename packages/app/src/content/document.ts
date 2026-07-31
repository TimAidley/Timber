/**
 * The editor's view of the on-disk `index.md` format.
 *
 * The format itself now lives in `@timber/generator` beside `parseFrontMatter` (its exact
 * inverse), so the editor, the CLI, and any importer all serialise identically — a file
 * written outside the editor that didn't match byte-for-byte used to show as modified the
 * moment the editor loaded it. This module stays as the app's local name for it.
 *
 * The editor keeps data and body as separate state (data in the schema form, body in
 * Milkdown — SPEC §8), but the generator's `renderPage` takes a whole `index.md`;
 * reassembling and feeding it through `renderPage` means live preview runs the EXACT
 * code path the CI build runs (preview ≡ build), not a parallel reimplementation.
 */
export { serializeDocument as reassembleDocument } from '@timber/generator';
