import { LEGACY_THEME, type ThemePaths } from '@timber/content';

/**
 * Naming for uploaded image assets, shared by the `image` field widget
 * ({@link ../forms/ImageField}) and the body editor's insert-image button, so both
 * stage bytes at the same kind of colocated path (SPEC §4 bundles).
 */
const EXT_BY_MIME: Record<string, string> = {
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/** File extension for a processed image, preferring its MIME, else the original name. */
export function extForMime(mime: string, fallbackName: string): string {
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const dot = fallbackName.lastIndexOf('.');
  return dot >= 0 ? fallbackName.slice(dot + 1).toLowerCase() : 'bin';
}

/** A slug-safe stem derived from an upload's filename (`My Photo.JPG` → `my-photo`). */
export function baseNameFrom(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return (
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'image'
  );
}

/** The repo-relative path an uploaded image is staged/committed to within a bundle. */
export function bundleImagePath(bundleDir: string, fileName: string, mime: string): string {
  return `${bundleDir}/images/${baseNameFrom(fileName)}.${extForMime(mime, fileName)}`;
}

/**
 * The repo-relative path a **theme** asset (font/logo/favicon) is staged/committed to under
 * the active theme's asset dir (SPEC §13) — `themes/<name>/assets/` when a theme is active,
 * else the legacy `assets/`. Unlike a bundle image, this is a theme-shared file, so it lives
 * in the theme's asset folder with a slug-safe name + explicit extension (from the processed
 * MIME for images, or the original extension for a passthrough binary).
 */
export function siteAssetPath(
  fileName: string,
  ext: string,
  theme: ThemePaths = LEGACY_THEME,
): string {
  return `${theme.assetsDir}/${baseNameFrom(fileName)}.${ext}`;
}

const MIME_BY_EXT: Record<string, string> = {
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** Best-effort image MIME from a path's extension — for typing a re-fetched Blob. */
export function mimeForPath(path: string): string {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}
