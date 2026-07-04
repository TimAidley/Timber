import { reencode } from './reencode.js';

// Web Worker entry (SPEC §7: run image processing off the main thread to keep the
// UI smooth). Only the CPU-heavy raster re-encode runs here — SVG sanitization
// stays on the main thread because DOMPurify needs a DOM, which workers lack.
//
// `self` is typed as `Window` by the DOM lib; in a worker it's actually a
// DedicatedWorkerGlobalScope, so we narrow to just the members we use.
interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
}
const ctx = self as unknown as WorkerScope;

ctx.onmessage = (e: MessageEvent): void => {
  const { file, longEdge, quality } = e.data as { file: Blob; longEdge: number; quality: number };
  reencode(file, longEdge, quality)
    .then(({ blob, width, height }) => ctx.postMessage({ ok: true, blob, width, height }))
    .catch((err: unknown) =>
      ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
};
