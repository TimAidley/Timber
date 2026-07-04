/**
 * Detect whether GIF bytes contain more than one frame. Animated GIFs must pass
 * through the pipeline untouched (SPEC §7) — drawing one to a canvas would flatten
 * it to a single frame — whereas a static GIF can be re-encoded to WebP like any
 * other raster image.
 *
 * This walks the GIF block structure (rather than a naive `0x2C` byte count, which
 * false-positives on color-table/pixel data) counting image-descriptor blocks, and
 * short-circuits as soon as it sees a second frame.
 */
export function isAnimatedGif(bytes: Uint8Array): boolean {
  if (bytes.length < 13) return false;

  // Header: "GIF87a" never animates; only "GIF89a" can.
  const sig = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!);
  const ver = String.fromCharCode(bytes[3]!, bytes[4]!, bytes[5]!);
  if (sig !== 'GIF') return false;
  if (ver !== '89a') return false;

  // Logical Screen Descriptor packed field → global color table size.
  const packed = bytes[10]!;
  const gctSize = (packed & 0x80) !== 0 ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
  let pos = 13 + gctSize;

  let frames = 0;
  while (pos < bytes.length) {
    const block = bytes[pos];
    if (block === undefined || block === 0x3b) break; // trailer / end of data

    if (block === 0x2c) {
      // Image Descriptor → one frame.
      frames += 1;
      if (frames > 1) return true;
      const lp = bytes[pos + 9];
      if (lp === undefined) break;
      const lctSize = (lp & 0x80) !== 0 ? 3 * (1 << ((lp & 0x07) + 1)) : 0;
      pos += 10 + lctSize + 1; // descriptor + local color table + LZW min-code-size
      pos = skipSubBlocks(bytes, pos);
    } else if (block === 0x21) {
      // Extension block: 0x21, label, then sub-blocks.
      pos += 2;
      pos = skipSubBlocks(bytes, pos);
    } else {
      break; // unexpected/corrupt — stop scanning
    }
  }

  return frames > 1;
}

/** Advance past a chain of length-prefixed sub-blocks (terminated by a 0 length). */
function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let pos = start;
  while (pos < bytes.length) {
    const size = bytes[pos];
    pos += 1;
    if (size === undefined || size === 0) break;
    pos += size;
  }
  return pos;
}
