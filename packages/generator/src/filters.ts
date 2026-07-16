import type { Liquid } from 'liquidjs';

/**
 * Comparison query filters (SPEC §6, "option A").
 *
 * LiquidJS's built-in `where` filter is **equality-only**, so "events from today
 * onward" or "products under £20" can't be expressed against it. These filters close
 * that gap for the common cases with a discoverable, `where`-shaped vocabulary:
 *
 *   {{ collections.events | where_gte: 'start', today | sort: 'start' | limit: 10 }}
 *
 * For compound predicates (`a >= x and b == y`) reach for LiquidJS's native
 * `where_exp` ("option B") — `where_exp: 'e', 'e.start >= today and e.open'`; and to
 * keep the *template* dumb, precompute a boolean in the type's schema `computed:` block
 * ("option C") and filter on it with plain `where`. These filters are the ergonomic
 * middle ground between those two.
 *
 * All are **pure** — they read only their arguments, never the clock — so preview ≡
 * build. The temporal operands (`today`/`now`) come from the injected {@link Clock}
 * context, not from inside the filter.
 */

/**
 * Order two values for the comparison filters. Numbers compare **numerically**; every
 * other pair compares **lexically** as strings — which is exactly right for ISO-8601
 * dates/datetimes (they sort chronologically as text) and the common case here. Returns
 * `NaN` when either side is null/undefined so a missing field is simply excluded from
 * range filters rather than matching spuriously.
 */
function compare(a: unknown, b: unknown): number {
  if (a == null || b == null) return NaN;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/** Read `item[prop]`, tolerating a non-object item (returns undefined). */
function pluck(item: unknown, prop: string): unknown {
  return item && typeof item === 'object' ? (item as Record<string, unknown>)[prop] : undefined;
}

/** Keep array items whose `prop` satisfies `test(compare(value, operand))`. */
function filterBy(
  arr: unknown,
  prop: string,
  operand: unknown,
  test: (ordering: number) => boolean,
): unknown[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((item) => {
    const ordering = compare(pluck(item, prop), operand);
    return !Number.isNaN(ordering) && test(ordering);
  });
}

/** Whole calendar days from `from` to `to` (positive when `to` is later), else null. */
function daysBetween(from: unknown, to: unknown): number | null {
  const a = Date.parse(String(from).slice(0, 10));
  const b = Date.parse(String(to).slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Register the comparison query filters (and `days_between`) on a LiquidJS engine.
 * Called from {@link createEngine} so every engine — the shared singleton and every
 * template-bound one — has them, in both the browser preview and the Node build.
 */
export function registerComparisonFilters(engine: Liquid): void {
  engine.registerFilter('where_gt', (arr, prop, v) => filterBy(arr, prop, v, (o) => o > 0));
  engine.registerFilter('where_gte', (arr, prop, v) => filterBy(arr, prop, v, (o) => o >= 0));
  engine.registerFilter('where_lt', (arr, prop, v) => filterBy(arr, prop, v, (o) => o < 0));
  engine.registerFilter('where_lte', (arr, prop, v) => filterBy(arr, prop, v, (o) => o <= 0));
  engine.registerFilter('where_ne', (arr, prop, v) =>
    Array.isArray(arr) ? arr.filter((item) => compare(pluck(item, prop), v) !== 0) : [],
  );
  engine.registerFilter('where_between', (arr, prop, lo, hi) =>
    filterBy(arr, prop, lo, (o) => o >= 0).filter(
      (item) => compare(pluck(item, prop), hi) <= 0,
    ),
  );
  // A display helper: "starts in {{ today | days_between: event.start }} days".
  engine.registerFilter('days_between', (from, to) => daysBetween(from, to));
}
