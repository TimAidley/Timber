/**
 * Delete-safety guard for site assets (SPEC §13, mirroring the guard on deleting a
 * referenced content object). Before removing a font/logo/favicon from `/assets`, the
 * manager scans the theme's source — templates and stylesheets — for a reference to it,
 * so it can warn "this is used in default.liquid" instead of silently breaking the build.
 *
 * Pure string scanning, no DOM/parse: an asset is referenced two ways, both handled —
 *  - **full path** (templates): `href="{{ site.basePath }}/assets/logo.webp"`, and
 *  - **assets-relative** (stylesheets): `url('fonts/serif.woff2')` inside `assets/theme.css`.
 * Matches are delimiter-bounded so `logo.webp` doesn't match `my-logo.webproj`.
 */

/** A source file scanned for references — a template or a stylesheet. */
export interface SourceText {
  path: string;
  text: string;
}

/** Characters that may sit immediately before/after an asset ref in HTML/CSS/attributes. */
const BOUNDARY = `\\s"'()/?#=,;{}<>`;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if `token` appears in `text` bounded by a delimiter (or string edge) on each side. */
function referencesToken(text: string, token: string): boolean {
  const re = new RegExp(`(^|[${BOUNDARY}])${escapeRegExp(token)}($|[${BOUNDARY}])`);
  return re.test(text);
}

/**
 * Return the paths of the sources that reference `assetPath`, in input order. An asset
 * under `assets/` is matched by its full repo path and by its assets-relative form (the
 * shape self-hosted fonts/background images take inside `assets/theme.css`).
 */
export function findAssetReferences(
  assetPath: string,
  sources: readonly SourceText[],
): string[] {
  const relative = assetPath.startsWith('assets/')
    ? assetPath.slice('assets/'.length)
    : assetPath;
  const tokens = relative === assetPath ? [assetPath] : [assetPath, relative];
  return sources
    .filter((s) => tokens.some((t) => referencesToken(s.text, t)))
    .map((s) => s.path);
}
