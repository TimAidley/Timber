import { describe, it, expect } from 'vitest';
import { validateFigureBlocks } from '../src/index.js';

const fig = (attrs: string, alt = 'A tree'): string =>
  [`:::figure${attrs}`, `![${alt}](media/tree.webp)`, '', 'A caption.', ':::', ''].join('\n');

describe('validateFigureBlocks (SPEC §7 body-image checks)', () => {
  it('passes a well-formed figure', () => {
    expect(validateFigureBlocks(fig('{layout="wrap-right" size="lg"}'))).toEqual([]);
  });

  it('passes a bare full-width figure (no attribute block)', () => {
    expect(validateFigureBlocks(fig(''))).toEqual([]);
  });

  it('flags a figure whose image is missing alt text', () => {
    const errors = validateFigureBlocks(fig('{layout="center"}', ''));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/missing alt text/);
  });

  it('flags an unknown layout value', () => {
    const errors = validateFigureBlocks(fig('{layout="diagonal"}'));
    expect(errors.some((e) => /unknown layout "diagonal"/.test(e.message))).toBe(true);
  });

  it('flags an unknown size value', () => {
    const errors = validateFigureBlocks(fig('{size="huge"}'));
    expect(errors.some((e) => /unknown size "huge"/.test(e.message))).toBe(true);
  });

  it('ignores a :::figure written inside a fenced code block', () => {
    const body = ['```md', ':::figure{layout="diagonal"}', '![](x.webp)', ':::', '```', ''].join('\n');
    expect(validateFigureBlocks(body)).toEqual([]);
  });

  it('reports problems across multiple figures', () => {
    const body = `${fig('{layout="nope"}')}\n${fig('{size="xl"}', '')}`;
    const errors = validateFigureBlocks(body);
    expect(errors.some((e) => /unknown layout/.test(e.message))).toBe(true);
    expect(errors.some((e) => /unknown size/.test(e.message))).toBe(true);
    expect(errors.some((e) => /missing alt text/.test(e.message))).toBe(true);
  });

  it('is a no-op for a body with no figures', () => {
    expect(validateFigureBlocks('# Title\n\nJust prose, no images.\n')).toEqual([]);
  });
});
