import { isAnimatedGif } from './animatedGif.js';
import type { ImagePlan } from './types.js';

/** SPEC §7 policy knobs. */
export const MAX_LONG_EDGE = 2048;
export const WEBP_QUALITY = 0.8;

export interface PlanInput {
  /** The file's MIME type. */
  type: string;
  /** The file's byte size. */
  size: number;
  /** Raw bytes — required to tell an animated GIF from a static one. */
  bytes?: Uint8Array;
}

/**
 * Decide what to do with an uploaded image — the pure heart of the pipeline
 * (SPEC §7). No canvas, no DOM, no I/O, so it's fully unit-testable:
 *   - SVG            → sanitize + pass through (raster re-encode would destroy it).
 *   - animated GIF   → pass through (canvas captures a single frame).
 *   - everything else (incl. static GIF) → re-encode to WebP, capping the long edge.
 */
export function planImageProcessing(input: PlanInput): ImagePlan {
  const type = input.type.toLowerCase();

  if (type === 'image/svg+xml') {
    return { action: 'passthrough-svg', targetLongEdge: 0, quality: 0, mime: 'image/svg+xml' };
  }

  if (type === 'image/gif' && input.bytes && isAnimatedGif(input.bytes)) {
    return { action: 'passthrough-gif', targetLongEdge: 0, quality: 0, mime: 'image/gif' };
  }

  return {
    action: 'reencode',
    targetLongEdge: MAX_LONG_EDGE,
    quality: WEBP_QUALITY,
    mime: 'image/webp',
  };
}
