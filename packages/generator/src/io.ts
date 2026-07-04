/**
 * FileSource — the I/O seam.
 *
 * The generator core stays pure and isomorphic by never importing `fs` or any
 * environment-specific API directly. Later phases (Node CLI build, in-browser
 * preview) provide a concrete FileSource; the core only ever depends on this
 * interface. Declared now so Phase 2/3 have a stable seam — intentionally unused
 * by the Phase 1 core, which renders from in-memory strings.
 */
export interface FileSource {
  /** Read a UTF-8 text file at a repo-relative path. */
  readText(path: string): Promise<string>;
  /** Read a binary file (e.g. an image) at a repo-relative path. */
  readBytes(path: string): Promise<Uint8Array>;
  /** List entries directly under a repo-relative directory path. */
  list(dir: string): Promise<string[]>;
  /** True if a file or directory exists at the given path. */
  exists(path: string): Promise<boolean>;
}

/** A sink for generator output (HTML pages, sitemaps, redirect stubs, …). */
export interface OutputSink {
  writeText(path: string, contents: string): Promise<void>;
  writeBytes(path: string, contents: Uint8Array): Promise<void>;
}
