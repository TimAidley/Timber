import { compileString, type Importer, type StringOptions } from 'sass';

/**
 * @timber/sass — isomorphic SCSS compilation.
 *
 * dart-sass runs in both Node and the browser (verified in Chromium), so Timber compiles
 * stylesheets the *same* way in the Node build and the browser preview — closing the last
 * preview ≡ build gap for styling (SPEC §6). The one wrinkle is `@import`/`@use` resolution:
 * dart-sass's default resolves against the filesystem, which the browser has no access to and
 * which wouldn't match the in-memory repo snapshot anyway. So we drive it with a custom
 * **in-memory importer** over a `{ repoPath → source }` map — the same map on both sides.
 */

export interface CompileScssOptions {
  /** The entry stylesheet source (may carry a Jekyll `---` front-matter fence + Liquid). */
  source: string;
  /** Repo path of the entry (e.g. `assets/css/style.scss`); its directory is an implicit import base. */
  entryPath?: string;
  /** Every available SCSS file keyed by repo path, for resolving `@import`/`@use` in memory. */
  files?: Record<string, string>;
  /** Extra base directories to resolve imports against (e.g. `['assets/_sass']`). */
  loadPaths?: string[];
  /**
   * Optional Liquid resolver, applied after the front-matter fence is stripped — resolves a
   * skin interpolation like `@import "…/{{ site.…skin }}"`. The caller supplies it (with the
   * generator engine + site context) so the core stays dependency-light. Omit for plain SCSS.
   */
  resolve?: (scss: string) => string | Promise<string>;
  /** Output style; defaults to `compressed` (production CSS). */
  style?: StringOptions<'sync'>['style'];
}

/** Collapse `.`/`..` and empty segments in a slash path. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/**
 * The candidate repo paths dart-sass's resolution would try for `@import "<url>"` under a base
 * directory: the file itself, its `_partial` form, and index files — with the `.scss` extension
 * where absent. First match in `files` wins.
 */
function resolveIn(
  files: Record<string, string>,
  base: string,
  url: string,
): string | undefined {
  const urlDir = dirOf(url);
  const name = url.slice(url.lastIndexOf('/') + 1);
  const prefix = [base, urlDir].filter(Boolean).join('/');
  const candidates = url.endsWith('.scss')
    ? [`${base}/${url}`]
    : [
        `${prefix}/${name}.scss`,
        `${prefix}/_${name}.scss`,
        `${base}/${url}/index.scss`,
        `${base}/${url}/_index.scss`,
      ];
  for (const candidate of candidates) {
    const path = normalize(candidate);
    if (path in files) return path;
  }
  return undefined;
}

/** An in-memory dart-sass importer resolving `@import`/`@use` against the `files` map. */
function memoryImporter(
  files: Record<string, string>,
  loadPaths: string[],
  entryDir: string,
): Importer<'sync'> {
  return {
    canonicalize(url, context) {
      const bases: string[] = [];
      // Relative to the importing file first (dart-sass semantics), then the load paths.
      if (context.containingUrl)
        bases.push(dirOf(decodeURI(context.containingUrl.pathname).replace(/^\//, '')));
      else bases.push(entryDir);
      bases.push(...loadPaths);
      for (const base of bases) {
        const hit = resolveIn(files, base, url);
        if (hit !== undefined) return new URL(`memory:/${hit}`);
      }
      return null;
    },
    load(canonicalUrl) {
      const path = decodeURI(canonicalUrl.pathname).replace(/^\//, '');
      const contents = files[path];
      return contents === undefined ? null : { contents, syntax: 'scss' };
    },
  };
}

/** Strip a leading Jekyll `---\n…\n---` front-matter fence (SCSS main files carry one); the
 *  body is optional, so an empty `---\n---` fence is handled too. */
function stripFrontMatter(source: string): string {
  return source.replace(/^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*\r?\n?/, '');
}

/**
 * Compile SCSS to CSS with an in-memory importer — identical in the browser and Node. Strips
 * the front-matter fence, resolves Liquid (if a `resolve` is given), then compiles, resolving
 * `@import`/`@use` against `files` (keyed by repo path) + `loadPaths` + the entry's own dir.
 */
export async function compileScss(options: CompileScssOptions): Promise<string> {
  let scss = stripFrontMatter(options.source);
  if (options.resolve) scss = await options.resolve(scss);
  const files = options.files ?? {};
  const entryDir = options.entryPath ? dirOf(options.entryPath) : '';
  const result = compileString(scss, {
    style: options.style ?? 'compressed',
    importers: [memoryImporter(files, options.loadPaths ?? [], entryDir)],
    // A Jekyll theme's SCSS is not the site owner's to fix, so silence its advisory
    // deprecation noise (legacy `@import`, color-function/division warnings in partials).
    silenceDeprecations: ['import'],
    quietDeps: true,
    ...(options.entryPath ? { url: new URL(`memory:/${options.entryPath}`) } : {}),
  });
  return result.css;
}
