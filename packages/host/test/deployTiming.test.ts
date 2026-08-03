import { describe, expect, it } from 'vitest';
import { medianDurationMs } from '../src/index.js';

/** A run that started at `t` seconds past the epoch and lasted `seconds`. */
function span(t: number, seconds: number): { startedAt: string; endedAt: string } {
  return {
    startedAt: new Date(t * 1000).toISOString(),
    endedAt: new Date((t + seconds) * 1000).toISOString(),
  };
}

describe('medianDurationMs', () => {
  it('has no estimate to give without samples', () => {
    expect(medianDurationMs([])).toBeUndefined();
  });

  it('takes the middle of an odd-sized sample', () => {
    expect(medianDurationMs([span(0, 60), span(100, 90), span(200, 120)])).toBe(90_000);
  });

  it('averages the two middle values of an even-sized sample', () => {
    expect(
      medianDurationMs([span(0, 60), span(100, 80), span(200, 100), span(300, 200)]),
    ).toBe(90_000);
  });

  it('resists the one run that queued behind a busy runner pool', () => {
    // The point of a median over a mean: a single 30-minute outlier must not leave every
    // subsequent ETA quoting half an hour.
    const withOutlier = [span(0, 90), span(100, 100), span(200, 110), span(300, 1800)];
    expect(medianDurationMs(withOutlier)).toBe(105_000);
  });

  it('drops spans that are unusable rather than clamping them', () => {
    const bad = [
      { startedAt: 'not a date', endedAt: new Date(1000).toISOString() },
      { startedAt: new Date(2000).toISOString(), endedAt: new Date(1000).toISOString() }, // ends before it starts
      { startedAt: new Date(1000).toISOString(), endedAt: new Date(1000).toISOString() }, // zero-length
    ];
    expect(medianDurationMs(bad)).toBeUndefined();
    expect(medianDurationMs([...bad, span(0, 60)])).toBe(60_000);
  });
});
