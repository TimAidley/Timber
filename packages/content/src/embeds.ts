import { embedUrlProblem } from '@timber/generator';
import type { FieldError } from './types.js';

/**
 * Body-level validation for `::embed` blocks (SPEC §7 → Embeds), the counterpart of
 * {@link validateFigureBlocks}. The content package has no Markdown parser, so this is
 * the same focused, dependency-free scan of the canonical form: enough to catch the
 * three things that would otherwise fail quietly at render time, since an embed the
 * generator can't resolve neutralises back to the source the author typed.
 *
 * It runs the URL through the generator's own resolver, so what blocks publishing here
 * is exactly what would have failed to render — one rule, not a second opinion.
 */
const EMBED_FENCE = /^:{2,3}embed(?:\{([^}]*)\})?\s*$/;
const CODE_FENCE = /^(?:```|~~~)/;
const ATTR = /(\w[\w-]*)="([^"]*)"/g;

const MODES = new Set(['inline', 'newtab']);
const RATIO = /^\d+(\.\d+)?(\s*\/\s*\d+(\.\d+)?)?$/;

export function validateEmbedBlocks(body: string): FieldError[] {
  const errors: FieldError[] = [];
  let inCode = false;

  for (const line of body.split('\n')) {
    if (CODE_FENCE.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    const fence = EMBED_FENCE.exec(line);
    if (!fence) continue;

    const attributes = new Map<string, string>();
    for (const [, key, value] of (fence[1] ?? '').matchAll(ATTR)) {
      attributes.set(key!, value!);
    }

    const url = attributes.get('url');
    if (url === undefined || url === '') {
      errors.push({ message: 'embed block has no url' });
    } else {
      const problem = embedUrlProblem(url);
      if (problem) errors.push({ message: `embed URL "${url}" ${problem}` });
    }

    const mode = attributes.get('mode');
    if (mode !== undefined && !MODES.has(mode)) {
      errors.push({ message: `embed has an unknown mode "${mode}"` });
    }

    const ratio = attributes.get('ratio');
    if (ratio !== undefined && !RATIO.test(ratio.trim())) {
      errors.push({ message: `embed has an unusable ratio "${ratio}"` });
    }
  }

  return errors;
}
