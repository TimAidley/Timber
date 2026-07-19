import { createEngine } from '@timber/generator';
import { compileScss } from '@timber/sass';
import type { HostProvider } from '@timber/host';

/**
 * The edited site's own theme + templates, loaded so the live preview renders like the
 * built page (SPEC §6/§13) rather than in editor chrome. These files live *outside* the
 * content snapshot (`loadSnapshot` only carries `content/` + `config/`), so we fetch them
 * straight from the branch via `loadTree` + `readBlob` — the same primitives the advanced
 * area uses to load `templates/*.liquid`.
 */
export interface SiteTheme {
  /** `templates/<name>.liquid` keyed by bare filename (e.g. `default.liquid`). */
  templates: Map<string, string>;
  /**
   * Every committed stylesheet (`assets/**\/*.css`), keyed by **repo path** (e.g.
   * `assets/theme.css` for the default theme, `assets/css/style.css` for an imported Jekyll
   * theme), with each file's own `url(...)` refs (fonts, background images) rewritten to
   * object URLs of the fetched bytes so they load in the sandboxed preview frame. The preview
   * inlines whichever of these the page actually `<link>`s. Empty when the site ships no CSS.
   */
  stylesheets: Map<string, string>;
  /** Raw `config/navigation.yml`, or null — used to rebuild `{{ site.nav }}`. */
  navigationYml: string | null;
  /** Object URLs minted for theme assets, so callers can revoke them on reload. */
  objectUrls: string[];
}

const TEMPLATE_RE = /^templates\/.+\.liquid$/;
const STYLESHEET_RE = /^assets\/.*\.css$/;
const SCSS_RE = /^assets\/.*\.scss$/;
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** Resolve a CSS-relative ref (e.g. `fonts/x.woff2` inside `assets/theme.css`) to a
 *  clean repo path (`assets/fonts/x.woff2`), collapsing `.`/`..` segments. */
function resolvePath(baseDir: string, ref: string): string {
  const parts = (ref.startsWith('/') ? ref : `${baseDir}/${ref}`).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * Rewrite `url(...)` references in a theme stylesheet to object URLs of the referenced
 * repo assets, so the theme's self-hosted fonts (and any CSS background images) render in
 * the sandboxed preview frame — where a relative/absolute path can't reach the repo.
 * Refs that are already absolute (`data:`/`http(s):`/`blob:`) or point at a missing blob
 * are left untouched.
 */
async function inlineCssAssets(
  css: string,
  baseDir: string,
  client: HostProvider,
  shaByPath: Map<string, string>,
  objectUrls: string[],
): Promise<string> {
  const refToPath = new Map<string, string>();
  for (const match of css.matchAll(CSS_URL_RE)) {
    const ref = match[2];
    if (ref === undefined) continue;
    const trimmed = ref.trim();
    if (refToPath.has(trimmed)) continue;
    if (/^(data:|https?:|blob:|#)/i.test(trimmed)) continue;
    const path = resolvePath(baseDir, trimmed);
    if (shaByPath.has(path)) refToPath.set(trimmed, path);
  }

  const refToUrl = new Map<string, string>();
  await Promise.all(
    [...refToPath].map(async ([ref, path]) => {
      const bytes = await client.readBinaryBlob(shaByPath.get(path)!);
      const url = URL.createObjectURL(new Blob([bytes]));
      objectUrls.push(url);
      refToUrl.set(ref, url);
    }),
  );

  return css.replace(CSS_URL_RE, (whole, _quote: string, ref: string) => {
    const url = refToUrl.get(ref.trim());
    return url ? `url(${url})` : whole;
  });
}

/**
 * Load a branch's templates + theme stylesheet + navigation so the preview can render
 * a page exactly as the build would. One tree read, then the blobs concurrently.
 */
export async function loadSiteTheme(
  client: HostProvider,
  ref: string,
): Promise<SiteTheme> {
  const tree = await client.loadTree(ref);
  const shaByPath = new Map(
    tree.entries.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha] as const),
  );
  const objectUrls: string[] = [];

  const templates = new Map<string, string>();
  await Promise.all(
    [...shaByPath]
      .filter(([path]) => TEMPLATE_RE.test(path))
      .map(async ([path, sha]) => {
        templates.set(path.slice('templates/'.length), await client.readBlob(sha));
      }),
  );

  // Every committed stylesheet, each inlined against its OWN directory so a relative
  // `url(fonts/x)` inside `assets/css/style.css` resolves to `assets/css/fonts/x`.
  const stylesheets = new Map<string, string>();
  await Promise.all(
    [...shaByPath]
      .filter(([path]) => STYLESHEET_RE.test(path))
      .map(async ([path, sha]) => {
        const baseDir = path.slice(0, path.lastIndexOf('/'));
        stylesheets.set(
          path,
          await inlineCssAssets(
            await client.readBlob(sha),
            baseDir,
            client,
            shaByPath,
            objectUrls,
          ),
        );
      }),
  );

  // Compile SCSS the same way the build does (isomorphic dart-sass, SPEC §6) so preview ≡ build
  // for styling. Load every `.scss` into a map for the in-memory importer, compile each MAIN
  // stylesheet (one carrying a `---` front-matter fence) to CSS under its `.css` path — so the
  // page's `<link>` to that `.css` inlines the compiled result — resolving `@import`/`@use`
  // against `assets/_sass`. Partials (no fence) are pulled in, not emitted.
  const scssFiles: Record<string, string> = {};
  await Promise.all(
    [...shaByPath]
      .filter(([path]) => SCSS_RE.test(path))
      .map(async ([path, sha]) => {
        scssFiles[path] = await client.readBlob(sha);
      }),
  );
  if (Object.keys(scssFiles).length > 0) {
    const engine = createEngine();
    const resolve = (scss: string): Promise<string> =>
      engine.parseAndRender(scss, { site: {} });
    for (const [path, source] of Object.entries(scssFiles)) {
      if (!/^---\r?\n/.test(source)) continue; // a partial — not a rendered stylesheet
      const css = await compileScss({
        source,
        entryPath: path,
        files: scssFiles,
        loadPaths: ['assets/_sass'],
        resolve,
      });
      const cssPath = path.replace(/\.scss$/, '.css');
      const baseDir = cssPath.slice(0, cssPath.lastIndexOf('/'));
      stylesheets.set(
        cssPath,
        await inlineCssAssets(css, baseDir, client, shaByPath, objectUrls),
      );
    }
  }

  const navSha =
    shaByPath.get('config/navigation.yml') ?? shaByPath.get('config/navigation.yaml');
  const navigationYml = navSha ? await client.readBlob(navSha) : null;

  return { templates, stylesheets, navigationYml, objectUrls };
}
