/** What the pipeline decided to do with an uploaded image (SPEC §7). */
export type ImageAction = 'reencode' | 'passthrough-svg' | 'passthrough-gif';

/** The processing plan for one file — the pure decision, before any pixels move. */
export interface ImagePlan {
  action: ImageAction;
  /** Cap for the longest edge on re-encode (px). */
  targetLongEdge: number;
  /** WebP quality on re-encode (0–1). */
  quality: number;
  /** Output MIME type. */
  mime: string;
}

/** The result of running an image through the pipeline. */
export interface ProcessedImage {
  /** The bytes to stage/commit. */
  blob: Blob;
  mime: string;
  action: ImageAction;
  /** Pixel dimensions of the output (re-encode only). */
  width?: number;
  height?: number;
  originalSize: number;
  processedSize: number;
  /**
   * True when we kept the ORIGINAL bytes because processing didn't make them
   * smaller (SPEC §7: "keep whichever is smaller of processed vs. original").
   */
  keptOriginal: boolean;
}
