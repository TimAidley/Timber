import { embedUrlProblem, isEmbedRatio, isEmbedWidth } from '@timber/generator';
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

/**
 * The sizing attributes: the generator's own rule for what each accepts, and an example
 * to put in the message — "unusable" on its own leaves you guessing at the vocabulary.
 */
const SIZING: ReadonlyArray<[string, (value: string) => boolean, string]> = [
  ['ratio', isEmbedRatio, '16 / 9'],
  ['frameRatio', isEmbedRatio, '16 / 9'],
  ['width', isEmbedWidth, '640px'],
  ['frameWidth', isEmbedWidth, '640px'],
];

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

    for (const [name, accepts, example] of SIZING) {
      const value = attributes.get(name);
      if (value !== undefined && !accepts(value)) {
        errors.push({
          message: `embed has an unusable ${name} "${value}" — expected something like "${example}"`,
        });
      }
    }
  }

  return errors;
}
