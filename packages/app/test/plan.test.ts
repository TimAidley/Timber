import { describe, expect, it } from 'vitest';
import { MAX_LONG_EDGE, WEBP_QUALITY, planImageProcessing } from '../src/media/plan.js';
import { fitWithin } from '../src/media/reencode.js';

/** A one-frame vs two-frame GIF, matching the animatedGif detector's walker. */
function gif(frames: number): Uint8Array {
  const bytes: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00];
  for (let i = 0; i < frames; i += 1) {
    bytes.push(0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x00);
  }
  bytes.push(0x3b);
  return new Uint8Array(bytes);
}

describe('planImageProcessing', () => {
  it('sanitizes-and-passes-through SVG', () => {
    expect(planImageProcessing({ type: 'image/svg+xml', size: 100 }).action).toBe('passthrough-svg');
  });

  it('passes an animated GIF through untouched', () => {
    expect(planImageProcessing({ type: 'image/gif', size: 100, bytes: gif(2) }).action).toBe(
      'passthrough-gif',
    );
  });

  it('re-encodes a static GIF', () => {
    expect(planImageProcessing({ type: 'image/gif', size: 100, bytes: gif(1) }).action).toBe('reencode');
  });

  it('re-encodes raster images to capped WebP', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'IMAGE/PNG']) {
      const plan = planImageProcessing({ type, size: 5_000_000 });
      expect(plan.action).toBe('reencode');
      expect(plan.mime).toBe('image/webp');
      expect(plan.targetLongEdge).toBe(MAX_LONG_EDGE);
      expect(plan.quality).toBe(WEBP_QUALITY);
    }
  });
});

describe('fitWithin', () => {
  it('never upscales', () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });

  it('caps the long edge and preserves aspect ratio', () => {
    expect(fitWithin(4000, 2000, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fitWithin(2000, 4000, 2048)).toEqual({ width: 1024, height: 2048 });
  });

  it('rounds to whole pixels and stays at least 1px', () => {
    const { width, height } = fitWithin(3000, 1000, 2048);
    expect(width).toBe(2048);
    expect(height).toBe(683); // round(1000 * 2048/3000)
  });
});
