export interface ReencodeResult {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Scale (w, h) down so the longest edge fits `longEdge`, preserving aspect ratio.
 * Never upscales. Pure — unit-tested without a canvas.
 */
export function fitWithin(w: number, h: number, longEdge: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= longEdge) return { width: w, height: h };
  const scale = longEdge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * Re-encode a raster image to WebP at a capped size (SPEC §7). Uses
 * `createImageBitmap` with `imageOrientation: 'from-image'` to bake in EXIF
 * rotation (so the re-encoded pixels are already upright and the stripped metadata
 * doesn't lose the orientation), then draws to an `OffscreenCanvas` and encodes.
 * Re-encoding also strips all metadata, including GPS — a privacy win.
 *
 * Browser-only (canvas + createImageBitmap); proven by the `browser` test project.
 * Callable from either the main thread or the Web Worker.
 */
export async function reencode(file: Blob, longEdge: number, quality: number): Promise<ReencodeResult> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, longEdge);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2D canvas context');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}
