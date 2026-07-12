import type { FieldError } from './types.js';

/**
 * Body-level validation for embedded image figures (SPEC §7). The content package has
 * no Markdown parser, so this is a focused, dependency-free scan of the **canonical
 * `:::figure` form the editor emits** — enough to enforce the two rules single-document
 * JSON Schema can't reach: alt text is mandatory (accessibility), and `layout`/`size`
 * must be from the bounded vocabulary. Fenced code regions are skipped so documenting
 * the syntax in a code block isn't flagged.
 *
 * Dangling-`src` detection is deliberately NOT here: SPEC frames orphan/broken-image
 * detection as a whole-repo build concern, not a per-object one.
 */
const LAYOUTS = new Set(['full-width', 'wrap-left', 'wrap-right', 'center']);
const SIZES = new Set(['sm', 'md', 'lg']);

const FIGURE_FENCE = /^:::figure(?:\{([^}]*)\})?\s*$/;
const IMAGE_LINE = /^!\[([^\]]*)\]\([^)]*\)\s*$/;
const CODE_FENCE = /^(?:```|~~~)/;
const ATTR = /(\w+)="([^"]*)"/g;

export function validateFigureBlocks(body: string): FieldError[] {
  const errors: FieldError[] = [];
  const lines = body.split('\n');
  let inCode = false;

  for (let i = 0; i < lines.length; i++) {
    if (CODE_FENCE.test(lines[i]!)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    const fence = FIGURE_FENCE.exec(lines[i]!);
    if (!fence) continue;

    for (const [, key, value] of (fence[1] ?? '').matchAll(ATTR)) {
      if (key === 'layout' && !LAYOUTS.has(value!)) {
        errors.push({ message: `figure has an unknown layout "${value}"` });
      } else if (key === 'size' && !SIZES.has(value!)) {
        errors.push({ message: `figure has an unknown size "${value}"` });
      }
    }

    // The image is the first non-blank line after the fence.
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === '') j++;
    const image = j < lines.length ? IMAGE_LINE.exec(lines[j]!.trim()) : null;
    if (image && image[1]!.trim() === '') {
      errors.push({ message: 'embedded image is missing alt text' });
    }
  }

  return errors;
}
