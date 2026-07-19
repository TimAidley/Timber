import { describe, it, expect } from 'vitest';
import { Liquid } from 'liquidjs';
import { registerJekyllFilters, strftime } from '../src/filters.js';

// Unit-test the raw filter logic on a plain LiquidJS engine (no auto-escape), so these
// assert the transformation itself; the escape/auto-escape interaction is covered by the
// e2e render test against Timber's real engine.
function engine(): Liquid {
  const e = new Liquid();
  registerJekyllFilters(e);
  return e;
}

async function render(tpl: string, scope: Record<string, unknown> = {}): Promise<string> {
  return engine().parseAndRender(tpl, scope);
}

describe('strftime', () => {
  const d = new Date('2026-05-02T09:07:05Z');
  it('handles Minima\'s default "%b %-d, %Y" (no-pad day)', () => {
    expect(strftime(d, '%b %-d, %Y')).toBe('May 2, 2026');
  });
  it('pads with %d and names months/days', () => {
    expect(strftime(d, '%A %B %d')).toBe('Saturday May 02');
  });
});

describe('jekyll ecosystem filters', () => {
  it('date applies Ruby strftime', async () => {
    expect(await render("{{ '2026-05-02T09:00:00Z' | date: '%b %-d, %Y' }}")).toBe(
      'May 2, 2026',
    );
  });
  it('date_to_xmlschema emits ISO-8601', async () => {
    expect(await render("{{ '2026-05-02' | date_to_xmlschema }}")).toBe(
      '2026-05-02T00:00:00.000Z',
    );
  });
  it('date_to_string abbreviates the month; date_to_long_string spells it out', async () => {
    expect(await render("{{ '2026-02-02' | date_to_string }}")).toBe('02 Feb 2026');
    expect(await render("{{ '2026-02-02' | date_to_long_string }}")).toBe(
      '02 February 2026',
    );
  });
  it('slugify', async () => {
    expect(await render("{{ 'Hello, World! 2026' | slugify }}")).toBe('hello-world-2026');
  });
  it('number_of_words', async () => {
    expect(await render("{{ 'one two three' | number_of_words }}")).toBe('3');
  });
  it('xml_escape', async () => {
    expect(await render('{{ \'<a href="x">\' | xml_escape }}')).toBe(
      '&lt;a href=&#34;x&#34;&gt;',
    );
  });
  it('jsonify', async () => {
    expect(await render('{{ obj | jsonify }}', { obj: { a: 1, b: 'x' } })).toBe(
      '{"a":1,"b":"x"}',
    );
  });
  it('empty/invalid dates degrade to empty string', async () => {
    expect(await render("{{ '' | date_to_xmlschema }}")).toBe('');
    expect(await render('{{ nope | date: "%Y" }}')).toBe('');
  });
});
