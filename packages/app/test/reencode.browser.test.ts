import { describe, expect, it } from 'vitest';
import { reencode } from '../src/media/reencode.js';

/**
 * The real pixel path (createImageBitmap → OffscreenCanvas → WebP), which jsdom
 * cannot run — so this spec executes in headless Chromium via the `browser`
 * project (`pnpm test:browser`). It proves the re-encode actually produces WebP
 * bytes and enforces the SPEC §7 long-edge cap.
 */
async function makePng(w: number, h: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  // A simple gradient so the encoder has real content to compress.
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#c0392b');
  grad.addColorStop(1, '#2b6cb0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

describe('reencode (real browser)', () => {
  it('re-encodes to WebP and caps the long edge at the target', async () => {
    const png = await makePng(3000, 1500);
    const { blob, width, height } = await reencode(png, 2048, 0.8);

    expect(blob.type).toBe('image/webp');
    expect(blob.size).toBeGreaterThan(0);
    expect(width).toBe(2048);
    expect(height).toBe(1024);
  });

  it('does not upscale a small image', async () => {
    const png = await makePng(320, 240);
    const { blob, width, height } = await reencode(png, 2048, 0.8);

    expect(blob.type).toBe('image/webp');
    expect(width).toBe(320);
    expect(height).toBe(240);
  });
});
