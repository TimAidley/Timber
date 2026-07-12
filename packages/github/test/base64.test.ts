import { describe, it, expect } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../src/index.js';

describe('base64 binary round-trip', () => {
  it('round-trips arbitrary bytes (including high/control values)', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 200, 254, 255, 13, 10]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it('decodes to an ArrayBuffer-backed view (usable as a Blob part)', () => {
    const out = base64ToBytes(bytesToBase64(new Uint8Array([1, 2, 3])));
    expect(out.buffer).toBeInstanceOf(ArrayBuffer);
    expect(out.length).toBe(3);
  });
});
