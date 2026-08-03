/**
 * The adapter between a `datetime` field's **stored** form and what the native
 * `<input type="datetime-local">` speaks.
 *
 * A stored datetime is RFC 3339 — that is what the validator's `date-time` format
 * requires (`@timber/content` `fieldToJsonSchema`). The native control neither
 * produces nor accepts it: it emits `YYYY-MM-DDTHH:mm` — no seconds, no zone — which
 * fails `date-time` outright, so a post with a perfectly good publish date typed into
 * the form was pinned to "Invalid — draft only" and could never be published. In the
 * other direction it renders an **empty box** for a real RFC 3339 value it can't parse,
 * so a hand-authored or previously-fixed date looked like it had been lost.
 *
 * Timber stores a datetime as a **wall clock** and serialises it with a `Z`
 * (`2026-08-03T14:30:00Z` for "half two on the third"). The editor's own timezone is
 * therefore never baked into committed content: two authors in different zones see the
 * same value, the browser preview matches the CI build (which runs in UTC), and
 * `assembleCollections` can keep sorting these strings lexically because every value
 * shares one offset. This is the same timezone-naive stance SPEC §11 takes for `today`.
 */

/** RFC 3339-ish: date, time, optional seconds/fraction, optional zone. */
const DATETIME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** True for a zone that means UTC, so its wall clock can be read off as written. */
function isUtc(offset: string | undefined): boolean {
  return offset === undefined || /^(Z|[+-]00:?00)$/i.test(offset);
}

/**
 * Stored value → the control's `value`. Returns `''` (an empty picker) for anything
 * unreadable, leaving the author to set a fresh date rather than showing a lie.
 * A value carrying a real offset is an *instant*, not a wall clock, so it is shown in
 * UTC — what is displayed is then always what is stored.
 */
export function datetimeToInput(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = DATETIME.exec(value.trim());
  if (!match) return '';
  const [, date, hhmm, seconds, offset] = match;

  if (!isUtc(offset)) {
    const at = Date.parse(value);
    if (Number.isNaN(at)) return '';
    const iso = new Date(at).toISOString();
    return seconds && seconds !== '00' ? iso.slice(0, 19) : iso.slice(0, 16);
  }
  return seconds && seconds !== '00' ? `${date}T${hhmm}:${seconds}` : `${date}T${hhmm}`;
}

/**
 * The control's `value` → the stored value: the typed wall clock, given seconds if it
 * has none and stamped `Z`. Empty clears the field (`undefined`, which the editor
 * deletes from front matter). Anything the pattern doesn't recognise is passed through
 * untouched so the validator reports it, rather than being silently mangled here.
 */
export function datetimeFromInput(text: string): string | undefined {
  const value = text.trim();
  if (!value) return undefined;
  const match = DATETIME.exec(value);
  if (!match) return value;
  const [, date, hhmm, seconds, offset] = match;
  if (offset !== undefined) return value;
  return `${date}T${hhmm}:${seconds ?? '00'}Z`;
}

/**
 * Is this stored value the zone-less shape the picker used to write (and that the
 * validator rejects)? Such a value is *already* blocking publish and is unambiguous, so
 * the widget upgrades it in place — see {@link datetimeToInput}'s note on why re-picking
 * the same minute in the control would otherwise fire no change event, leaving the
 * author stuck on a page that looks correct but refuses to leave draft.
 */
export function isZonelessDatetime(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = DATETIME.exec(value.trim());
  return match !== null && match[4] === undefined;
}
