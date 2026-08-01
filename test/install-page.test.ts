import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';

// docs/install.html carries the setup instructions for every host / sign-in /
// deploy combination and shows one path at a time. Nothing else validates it —
// a typo in a data-when term just silently hides a step — so these tests drive
// the real page in jsdom rather than reimplementing its filter logic.

const PAGE = fileURLToPath(new URL('../docs/install.html', import.meta.url));

interface Install {
  axes: string[];
  setSelection(state: Record<string, string>): void;
  getState(): Record<string, string>;
  vars(): Record<string, string>;
  visibleOptions(axis: string): string[];
  setFields(fields: Record<string, string>): void;
  visibleSteps(): string[];
}

let dom: JSDOM;
let doc: Document;
let install: Install;

/** Every combination the chooser can actually reach, found by walking it. */
function validCombinations(): Record<string, string>[] {
  const [first, ...rest] = install.axes;
  let combos: Record<string, string>[] = install
    .visibleOptions(first)
    .map((value) => ({ [first]: value }));

  for (const axis of rest) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      install.setSelection(combo);
      for (const value of install.visibleOptions(axis)) {
        next.push({ ...combo, [axis]: value });
      }
    }
    combos = next;
  }
  return combos;
}

function load(url: string): JSDOM {
  return new JSDOM(readFileSync(PAGE, 'utf8'), { runScripts: 'dangerously', url });
}

beforeAll(() => {
  dom = load('https://example.test/install.html');
  doc = dom.window.document;
  install = (dom.window as unknown as { __timberInstall: Install }).__timberInstall;
});

describe('docs/install.html', () => {
  it('runs its script and exposes the chooser', () => {
    expect(install).toBeTruthy();
    expect(install.axes).toEqual(['host', 'auth', 'deploy', 'domain']);
  });

  it('only references axes and values the chooser offers', () => {
    const declared = new Map<string, Set<string>>();
    for (const axis of install.axes) {
      const inputs = doc.querySelectorAll<HTMLInputElement>(`input[name="${axis}"]`);
      declared.set(axis, new Set([...inputs].map((i) => i.value)));
    }

    for (const el of doc.querySelectorAll('[data-when]')) {
      for (const term of el.getAttribute('data-when')!.trim().split(/\s+/)) {
        const [axis, values] = term.split(':');
        expect(declared.has(axis), `unknown axis "${axis}" in data-when="${term}"`).toBe(
          true,
        );
        for (const value of (values ?? '').split(',')) {
          expect(
            declared.get(axis)!.has(value),
            `unknown value "${value}" for axis "${axis}" in data-when="${term}"`,
          ).toBe(true);
        }
      }
    }
  });

  it('gives every step a unique id, so ticks and anchors are stable', () => {
    const ids = [...doc.querySelectorAll('.step')].map((s) => s.id);
    expect(ids.every(Boolean), 'every .step needs an id').toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('substitutes every data-var it uses', () => {
    const known = new Set(Object.keys(install.vars()));
    for (const el of doc.querySelectorAll('[data-var]')) {
      const name = el.getAttribute('data-var')!;
      expect(known.has(name), `data-var="${name}" is not produced by computeVars`).toBe(
        true,
      );
    }
  });

  it('reaches every host, sign-in method and deploy target', () => {
    const combos = validCombinations();
    for (const axis of install.axes) {
      const reached = new Set(combos.map((c) => c[axis]));
      const offered = [
        ...doc.querySelectorAll<HTMLInputElement>(`input[name="${axis}"]`),
      ].map((i) => i.value);
      expect([...reached].sort()).toEqual([...offered].sort());
    }
  });

  it('leaves no combination without instructions', () => {
    for (const combo of validCombinations()) {
      install.setSelection(combo);
      const steps = install.visibleSteps();
      const label = JSON.stringify(combo);

      expect(steps.length, `${label} shows no steps at all`).toBeGreaterThan(2);
      expect(steps, `${label} never says how to create the repo`).toContain(
        'create-repo',
      );
      expect(steps, `${label} never says how to set baseUrl`).toContain('base-url');

      // Each path has to end with a way to actually sign in.
      const signIn = combo.auth === 'pat' ? 'pat-signin' : 'signin';
      expect(steps, `${label} never reaches a sign-in step`).toContain(signIn);
    }
  });

  it('snaps a now-invalid choice instead of showing a dead path', () => {
    // Device flow and Cloudflare Pages are GitHub-only; switching hosts must not
    // leave them selected with no steps behind them.
    install.setSelection({ host: 'github', auth: 'app-device', deploy: 'cloudflare' });
    expect(install.getState().auth).toBe('app-device');

    install.setSelection({ host: 'codeberg' });
    expect(install.getState().auth).toBe('pat');
    expect(install.getState().deploy).toBe('pages');
    expect(install.visibleSteps().length).toBeGreaterThan(2);
  });

  it('builds concrete URLs from the identity fields', () => {
    install.setSelection({
      host: 'github',
      auth: 'app-redirect',
      deploy: 'pages',
      domain: 'default',
    });
    install.setFields({ owner: 'TimAidley', repo: 'my-site', editorPath: 'edit' });

    const vars = install.vars();
    // Pages serves from the lowercased login — a capitalised owner is a 404.
    expect(vars.siteUrl).toBe('https://timaidley.github.io/my-site');
    expect(vars.editorUrl).toBe('https://timaidley.github.io/my-site/edit/');
    expect(vars.editorOrigin).toBe('https://timaidley.github.io');
    expect(vars.baseUrlLine).toBe('baseUrl: https://timaidley.github.io/my-site');

    // The GitHub App's callback URL must equal the editor URL exactly.
    const callback = [...doc.querySelectorAll('#github-app [data-var="editorUrl"]')];
    expect(callback.length).toBeGreaterThan(0);
    expect(callback[0].textContent).toBe(vars.editorUrl);
  });

  it('drops the repo subpath when the site moves to a root', () => {
    install.setFields({ owner: 'TimAidley', repo: 'my-site', domain: 'www.example.com' });

    install.setSelection({ host: 'github', deploy: 'cloudflare', domain: 'default' });
    expect(install.vars().siteUrl).toBe('https://my-site.pages.dev');

    install.setSelection({ host: 'github', deploy: 'pages', domain: 'custom' });
    expect(install.vars().siteUrl).toBe('https://www.example.com');
    expect(install.vars().editorUrl).toBe('https://www.example.com/edit/');
    // The bare host is what a DNS CNAME record points at.
    expect(install.vars().pagesHost).toBe('timaidley.github.io');
  });

  it('honours a custom editor path everywhere the editor URL appears', () => {
    install.setSelection({
      host: 'github',
      auth: 'pat',
      deploy: 'pages',
      domain: 'default',
    });
    install.setFields({ owner: 'timaidley', repo: 'my-site', editorPath: 'admin' });

    expect(install.vars().editorUrl).toBe('https://timaidley.github.io/my-site/admin/');
    for (const el of doc.querySelectorAll('[data-var="editorUrl"]')) {
      expect(el.textContent).toBe(install.vars().editorUrl);
    }
  });

  it('restores a shared selection from the query string', () => {
    const shared = load('https://example.test/install.html?host=codeberg&auth=oauth');
    const api = (shared.window as unknown as { __timberInstall: Install })
      .__timberInstall;

    expect(api.getState()).toMatchObject({ host: 'codeberg', auth: 'oauth' });
    expect(api.visibleSteps()).toContain('codeberg-oauth-app');
  });

  it('opens a deep-linked step even when it belongs to another path', () => {
    // Other docs link straight at a step (…/install.html#content-checks). Landing on a
    // hidden element would look like the page had lost it.
    const deep = load('https://example.test/install.html#codeberg-oauth-app');
    const target = deep.window.document.getElementById('codeberg-oauth-app')!;

    expect(deep.window.document.body.classList.contains('show-all')).toBe(true);
    expect((target as HTMLElement).hidden).toBe(false);
  });

  it('keeps the fragment when it writes the selection to the URL', () => {
    const deep = load('https://example.test/install.html#content-checks');
    expect(deep.window.location.hash).toBe('#content-checks');
    expect(deep.window.location.search).toContain('host=github');
  });

  it('reads without JavaScript — no block is hidden by default markup', () => {
    const plain = new JSDOM(readFileSync(PAGE, 'utf8'));
    const hidden = [...plain.window.document.querySelectorAll('[data-when]')].filter(
      (el) => (el as HTMLElement).hidden,
    );
    expect(hidden).toHaveLength(0);
    expect(plain.window.document.documentElement.className).toBe('no-js');
  });
});
