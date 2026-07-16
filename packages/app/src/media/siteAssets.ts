import type { TreeEntry } from '@timber/host';
import { extensionOf } from './assetPolicy.js';

/**
 * Listing of the site-wide `/assets` folder for the asset manager (SPEC §13). Pure
 * classification of a repo tree into displayable entries — which thumbnail to show, how
 * to label the type — kept out of React so it's unit-testable. The manager itself adds
 * upload/delete on top; this just answers "what's in `/assets` and what is each thing?".
 */

/** Broad type of an asset, driving how the manager renders it (thumbnail vs. icon+label). */
export type AssetCategory = 'image' | 'icon' | 'font' | 'document' | 'style' | 'other';

export interface SiteAsset {
  /** Full repo-relative path, e.g. `assets/fonts/source-serif.woff2`. */
  path: string;
  /** Basename shown as the primary label, e.g. `source-serif.woff2`. */
  name: string;
  ext: string;
  /** Byte size when the tree reported it (blobs do; absent is possible). */
  size?: number;
  category: AssetCategory;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg']);
const FONT_EXTS = new Set(['woff2', 'woff', 'ttf', 'otf']);

/** Map an extension to its display category. Images (incl. SVG) render as thumbnails; the
 *  rest render as an icon + label, since a font/PDF/`.ico` has no useful inline preview. */
export function categorize(ext: string): AssetCategory {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'ico') return 'icon';
  if (FONT_EXTS.has(ext)) return 'font';
  if (ext === 'pdf') return 'document';
  if (ext === 'css') return 'style';
  return 'other';
}

/** True for image categories the manager can show as an inline thumbnail. */
export function isThumbnailable(asset: SiteAsset): boolean {
  return asset.category === 'image';
}

/**
 * Extract the site assets from a repo tree: every blob directly or deeply under `assets/`,
 * as classified {@link SiteAsset} entries sorted by path. The editable stylesheet(s) are
 * included so the manager is a faithful folder view (they're also editable under Styles).
 */
export function listSiteAssets(entries: readonly TreeEntry[]): SiteAsset[] {
  return entries
    .filter((e) => e.type === 'blob' && e.path.startsWith('assets/'))
    .map((e): SiteAsset => {
      const name = e.path.slice(e.path.lastIndexOf('/') + 1);
      const ext = extensionOf(name);
      return {
        path: e.path,
        name,
        ext,
        ...(typeof e.size === 'number' ? { size: e.size } : {}),
        category: categorize(ext),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
