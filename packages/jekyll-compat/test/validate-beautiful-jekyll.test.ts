import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, renderPage } from '@timber/generator';
import { importJekyllTheme } from '../src/importTheme.js';
import { registerJekyllCompat } from '../src/register.js';

/**
 * The residue of "mainly compatible": the one hand-edit Beautiful-Jekyll needs that the
 * mechanical transform deliberately does NOT do. `head.html` uses a parenthesized boolean
 * `and (site.title != pagetitle)`; LiquidJS rejects parentheses in conditions (SPEC §6:
 * "no parentheses in boolean conditions"), and auto-stripping parens is unsafe (they also
 * denote ranges), so a porter removes them by hand. One line, one file, out of 33.
 */
const MANUAL_PORT_FIXES: Array<[string, RegExp, string]> = [
  ['head', /and \(site\.title != pagetitle\)/, 'and site.title != pagetitle'],
];

function applyManualFixes(templates: Record<string, string>): Record<string, string> {
  const out = { ...templates };
  for (const [name, find, replace] of MANUAL_PORT_FIXES) {
    if (out[name]) out[name] = out[name].replace(find, replace);
  }
  return out;
}

/**
 * Second-theme validation: confirm the import transform generalizes beyond Minima to a
 * larger, real theme (Beautiful-Jekyll, MIT — 6 layouts + 27 includes vendored under
 * test/fixtures). The strong signal is that EVERY imported template parses as valid Liquid
 * under Timber's engine — that exercises the transform across 33 files of real-world idiom
 * variety (dynamic-name includes, `include.*` params, nested control flow, layout chains).
 *
 * Known scoped gap (audit's `layout.*` RED item, Tier-B): Beautiful-Jekyll's `base` layout
 * stashes its CSS/JS asset lists in its OWN front matter and reads them back via `layout.*`.
 * We don't surface a per-layout `layout` object, so those `<link>`/`<script>` lists render
 * empty — the reading experience (chrome, nav, content) is intact, the asset wiring is not.
 * That's a documented follow-up, not a transform failure.
 */

const here = dirname(fileURLToPath(import.meta.url));
const BJ = join(here, 'fixtures', 'beautiful-jekyll');

let templates: Record<string, string>;

async function readDir(sub: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of await readdir(join(BJ, sub))) {
    if (file.endsWith('.html'))
      out[file.replace(/\.html$/, '')] = await readFile(join(BJ, sub, file), 'utf8');
  }
  return out;
}

beforeAll(async () => {
  templates = applyManualFixes(
    importJekyllTheme(
      { ...(await readDir('_layouts')), ...(await readDir('_includes')) },
      'base',
    ),
  );
});

describe('Beautiful-Jekyll import transform generalizes', () => {
  it('imports every layout + include into valid, parseable Liquid', () => {
    const engine = createEngine(templates, registerJekyllCompat);
    const failures: string[] = [];
    for (const [name, source] of Object.entries(templates)) {
      try {
        engine.parse(source);
      } catch (e) {
        failures.push(`${name}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('leaves no raw Jekyll include syntax (x.html / include.*) after import', () => {
    for (const source of Object.values(templates)) {
      expect(source).not.toMatch(/include\s+[\w-]+\.html/); // unconverted `include foo.html`
      expect(source).not.toContain('include.'); // unconverted include.* namespace
    }
  });

  it('renders the core reading path (a post) end-to-end', async () => {
    // Minimal site config + a post. Missing site.* keys render empty (jsTruthy guards),
    // and the layout.* asset lists are absent (documented gap) — but the body, title, and
    // date must render, proving the full base→post→includes chain executes.
    const site = {
      title: 'Timberline',
      basePath: '/mysite',
      baseUrl: 'https://example.github.io/mysite',
    };
    const html = await renderPage({
      markdown:
        '---\ntitle: Hello Beautiful World\ndate: 2026-05-02T09:00:00Z\n---\nBody with **bold** text.',
      template: templates.post!,
      templates,
      site,
      url: '/2026/05/02/hello/',
      collection: 'posts',
      extend: registerJekyllCompat,
    });
    expect(html).toContain('Hello Beautiful World'); // page.title in the post header
    expect(html).toContain('<strong>bold</strong>'); // markdown body → html
    expect(html).toContain('<!DOCTYPE html>'); // base layout chrome rendered
    expect(html).not.toContain('{%'); // no unresolved tags
    expect(html).not.toContain('{{'); // no unresolved outputs
  });
});
