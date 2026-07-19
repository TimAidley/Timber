import type { Liquid } from 'liquidjs';

/**
 * The Jekyll *ecosystem* Liquid filters Timber doesn't ship natively — the ones themes
 * reach for that aren't part of Timber's own render contract. (The highest-frequency
 * Jekyll filters, `relative_url` / `absolute_url`, are NOT here: they're native in
 * `@timber/generator`.) Everything here is pure — no context, no clock — so preview ≡ build.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** A tolerant Date from a string/number/Date; null when unparseable or empty. */
function toDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Minimal Ruby-`strftime` covering the tokens real Jekyll themes use (Minima's default
 * `date_format` is `"%b %-d, %Y"`). UTC throughout, so it stays timezone-naive per SPEC §6
 * ("timezones are explicitly not a concern"). The no-pad variants (`%-d`, `%-m`) are the
 * main reason we override LiquidJS's built-in `date`, which doesn't support them.
 */
export function strftime(date: Date, fmt: string): string {
  const map: Record<string, string | number> = {
    Y: date.getUTCFullYear(),
    m: pad(date.getUTCMonth() + 1),
    '-m': date.getUTCMonth() + 1,
    d: pad(date.getUTCDate()),
    '-d': date.getUTCDate(),
    e: String(date.getUTCDate()).padStart(2, ' '),
    b: MONTHS[date.getUTCMonth()]!.slice(0, 3),
    B: MONTHS[date.getUTCMonth()]!,
    a: DAYS[date.getUTCDay()]!.slice(0, 3),
    A: DAYS[date.getUTCDay()]!,
    H: pad(date.getUTCHours()),
    M: pad(date.getUTCMinutes()),
    S: pad(date.getUTCSeconds()),
    j: pad(
      Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000),
      3,
    ),
    Z: 'UTC',
    z: '+0000',
    '%': '%',
  };
  // Longest tokens first so `%-d` wins over `%d`.
  return fmt.replace(/%-?[A-Za-z%]/g, (tok) => {
    const key = tok.slice(1);
    return key in map ? String(map[key]) : tok;
  });
}

function xmlEscape(input: unknown): string {
  return String(input ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' })[c]!,
  );
}

/** Register the Jekyll ecosystem filters on a LiquidJS engine. */
export function registerJekyllFilters(engine: Liquid): void {
  // `date` — Ruby strftime (handles `%-d` etc.). `"now"`/`"today"` resolve to the caller's
  // clock via the render context is not available in a pure filter, so accept a Date/string.
  engine.registerFilter('date', (input: unknown, fmt: unknown): string => {
    const d = toDate(input);
    if (!d) return '';
    return typeof fmt === 'string' ? strftime(d, fmt) : d.toISOString();
  });
  engine.registerFilter('date_to_xmlschema', (input: unknown): string => {
    const d = toDate(input);
    return d ? d.toISOString() : '';
  });
  engine.registerFilter('date_to_string', (input: unknown): string => {
    const d = toDate(input);
    return d ? strftime(d, '%d %b %Y') : '';
  });
  engine.registerFilter('date_to_long_string', (input: unknown): string => {
    const d = toDate(input);
    return d ? strftime(d, '%d %B %Y') : '';
  });
  engine.registerFilter('xml_escape', (input: unknown): string => xmlEscape(input));
  engine.registerFilter('cgi_escape', (input: unknown): string =>
    encodeURIComponent(String(input ?? '')).replace(/%20/g, '+'),
  );
  engine.registerFilter('uri_escape', (input: unknown): string =>
    encodeURI(String(input ?? '')),
  );
  engine.registerFilter('slugify', (input: unknown): string =>
    String(input ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  );
  engine.registerFilter('jsonify', (input: unknown): string => JSON.stringify(input));
  engine.registerFilter('number_of_words', (input: unknown): number => {
    const s = String(input ?? '').trim();
    return s ? s.split(/\s+/).length : 0;
  });
}
