/**
 * Build the temporal context (`now` / `today`) that time-relative templates read
 * (SPEC §6) — e.g. `where_exp: 'e', 'e.start >= today'` or a page's own
 * `{% if page.start >= today %}`.
 *
 * The generator core is **pure** — it must never read the clock itself, or preview
 * and build would diverge and tests would be non-deterministic. So the *caller* (the
 * Node CLI, the browser preview, or a test) supplies the `Date`; this helper only
 * formats it. CI's daily scheduled rebuild (SPEC §6) is what keeps `today` fresh so
 * "upcoming" stays correct without runtime logic.
 *
 * Calendar-date, timezone-naive (SPEC §6): `today` is the UTC calendar date, so date
 * comparisons like `start >= today` are midnight-to-midnight. `now` keeps the full
 * ISO-8601 instant for finer-grained needs.
 */
export interface Clock {
  /** Full ISO-8601 instant, e.g. `2026-07-15T10:30:00.000Z`. */
  now: string;
  /** UTC calendar date `YYYY-MM-DD`, e.g. `2026-07-15`. */
  today: string;
}

/** Derive the {@link Clock} template context from a caller-supplied instant. */
export function buildClock(date: Date): Clock {
  const now = date.toISOString();
  return { now, today: now.slice(0, 10) };
}
