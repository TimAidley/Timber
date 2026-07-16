import { describe, it, expect } from 'vitest';
import { engine, buildClock } from '../src/index.js';

/** Render a bare Liquid expression against a scope, trimming whitespace. */
function render(src: string, scope: Record<string, unknown>): string {
  return engine.parseAndRenderSync(src, scope).trim();
}

const EVENTS = [
  { slug: 'past', start: '2026-01-01' },
  { slug: 'today', start: '2026-07-15' },
  { slug: 'soon', start: '2026-08-01' },
  { slug: 'later', start: '2026-12-01' },
  { slug: 'undated' }, // missing `start`
];

describe('comparison query filters (option A)', () => {
  it('where_gte keeps items at or after the operand (missing field excluded)', () => {
    const out = render(
      "{{ events | where_gte: 'start', today | map: 'slug' | join: ',' }}",
      { events: EVENTS, today: '2026-07-15' },
    );
    expect(out).toBe('today,soon,later');
  });

  it('where_gt is strict', () => {
    const out = render(
      "{{ events | where_gt: 'start', today | map: 'slug' | join: ',' }}",
      { events: EVENTS, today: '2026-07-15' },
    );
    expect(out).toBe('soon,later');
  });

  it('where_lt keeps items strictly before the operand', () => {
    const out = render(
      "{{ events | where_lt: 'start', today | map: 'slug' | join: ',' }}",
      { events: EVENTS, today: '2026-07-15' },
    );
    expect(out).toBe('past');
  });

  it('where_between is inclusive on both ends', () => {
    const out = render(
      "{{ events | where_between: 'start', '2026-07-01', '2026-09-01' | map: 'slug' | join: ',' }}",
      { events: EVENTS },
    );
    expect(out).toBe('today,soon');
  });

  it('compares numbers numerically, not lexically', () => {
    const products = [{ n: 2 }, { n: 10 }, { n: 100 }];
    const out = render("{{ products | where_lt: 'n', 20 | map: 'n' | join: ',' }}", {
      products,
    });
    expect(out).toBe('2,10');
  });

  it('filters compose into filter → sort → limit for "next N upcoming"', () => {
    const out = render(
      "{{ events | where_gte: 'start', today | sort: 'start' | map: 'slug' | join: ',' }}",
      { events: EVENTS, today: '2026-07-15' },
    );
    expect(out).toBe('today,soon,later');
  });

  it('days_between reports whole calendar days (for display)', () => {
    expect(render("{{ today | days_between: '2026-07-18' }}", { today: '2026-07-15' })).toBe(
      '3',
    );
    expect(render("{{ '2026-07-18' | days_between: today }}", { today: '2026-07-15' })).toBe(
      '-3',
    );
  });
});

describe('where_exp with injected temporal context (option B)', () => {
  it('expresses a compound predicate LiquidJS `where` cannot', () => {
    const events = [
      { slug: 'open-future', start: '2026-08-01', open: true },
      { slug: 'closed-future', start: '2026-09-01', open: false },
      { slug: 'open-past', start: '2026-01-01', open: true },
    ];
    const out = render(
      "{{ events | where_exp: 'e', 'e.start >= today and e.open' | map: 'slug' | join: ',' }}",
      { events, today: '2026-07-15' },
    );
    expect(out).toBe('open-future');
  });
});

describe('buildClock', () => {
  it('derives ISO `now` and UTC calendar `today` from a supplied instant', () => {
    const clock = buildClock(new Date('2026-07-15T10:30:00.000Z'));
    expect(clock.now).toBe('2026-07-15T10:30:00.000Z');
    expect(clock.today).toBe('2026-07-15');
  });
});
