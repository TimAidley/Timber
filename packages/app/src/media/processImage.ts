import { planImageProcessing } from './plan.js';
import { sanitizeSvg } from './sanitizeSvg.js';
import type { ProcessedImage } from './types.js';

interface WorkerResult {
  ok: boolean;
  blob?: Blob;
  width?: number;
  height?: number;
  error?: string;
}

/** Run the raster re-encode in the Web Worker and await its result. */
function reencodeInWorker(
  file: Blob,
  longEdge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent): void => {
      const data = e.data as WorkerResult;
      worker.terminate();
      if (data.ok && data.blob) {
        resolve({ blob: data.blob, width: data.width ?? 0, height: data.height ?? 0 });
      } else {
        reject(new Error(data.error ?? 'image worker failed'));
      }
    };
    worker.onerror = (e: ErrorEvent): void => {
      worker.terminate();
      reject(new Error(e.message || 'image worker error'));
    };
    worker.postMessage({ file, longEdge, quality });
  });
}

/**
 * Process an uploaded image before it is staged/committed (SPEC §7): decide the
 * plan, then sanitize (SVG), pass through (animated GIF), or re-encode to WebP off
 * the main thread. Always keeps whichever is smaller of processed vs. original.
 */
export async function processImage(file: File): Promise<ProcessedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const plan = planImageProcessing({ type: file.type, size: file.size, bytes });

  if (plan.action === 'passthrough-svg') {
    const clean = sanitizeSvg(new TextDecoder().decode(bytes));
    const blob = new Blob([clean], { type: 'image/svg+xml' });
    return {
      blob,
      mime: 'image/svg+xml',
      action: plan.action,
      originalSize: file.size,
      processedSize: blob.size,
      keptOriginal: false,
    };
  }

  if (plan.action === 'passthrough-gif') {
    return {
      blob: file,
      mime: 'image/gif',
      action: plan.action,
      originalSize: file.size,
      processedSize: file.size,
      keptOriginal: true,
    };
  }

  const { blob, width, height } = await reencodeInWorker(file, plan.targetLongEdge, plan.quality);

  // Keep whichever is smaller (SPEC §7): if WebP didn't beat the original, keep it.
  if (blob.size >= file.size) {
    return {
      blob: file,
      mime: file.type,
      action: 'reencode',
      width,
      height,
      originalSize: file.size,
      processedSize: file.size,
      keptOriginal: true,
    };
  }

  return {
    blob,
    mime: plan.mime,
    action: 'reencode',
    width,
    height,
    originalSize: file.size,
    processedSize: blob.size,
    keptOriginal: false,
  };
}
