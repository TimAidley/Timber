import { describe, expect, it } from 'vitest';
import { isAnimatedGif } from '../src/media/animatedGif.js';

/** Build a minimal but structurally-valid GIF with `frames` image descriptors. */
function gif(version: '87a' | '89a', frames: number): Uint8Array {
  const bytes: number[] = [];
  // Header "GIF8" + version + "a"
  bytes.push(0x47, 0x49, 0x46, 0x38, version === '89a' ? 0x39 : 0x37, 0x61);
  // Logical Screen Descriptor: 1×1, no global color table
  bytes.push(0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00);
  for (let i = 0; i < frames; i += 1) {
    // Image Descriptor: separator + 4×u16 geometry + packed(no LCT)
    bytes.push(0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
    bytes.push(0x02); // LZW minimum code size
    bytes.push(0x00); // empty sub-block chain terminator
  }
  bytes.push(0x3b); // trailer
  return new Uint8Array(bytes);
}

describe('isAnimatedGif', () => {
  it('detects a multi-frame GIF89a as animated', () => {
    expect(isAnimatedGif(gif('89a', 2))).toBe(true);
    expect(isAnimatedGif(gif('89a', 5))).toBe(true);
  });

  it('treats a single-frame GIF as static', () => {
    expect(isAnimatedGif(gif('89a', 1))).toBe(false);
  });

  it('treats GIF87a as static regardless of frame count', () => {
    expect(isAnimatedGif(gif('87a', 3))).toBe(false);
  });

  it('rejects non-GIF bytes', () => {
    expect(isAnimatedGif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // PNG
    expect(isAnimatedGif(new Uint8Array([]))).toBe(false);
  });
});
