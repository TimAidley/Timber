import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ContentObject, ContentTypeSchema } from '@timber/content';
import { ContentList } from '../src/components/ContentList.js';
import '../src/styles.css';

/**
 * The grouping/sorting/filtering rules are unit-tested in `contentList.test.ts`; this
 * spec drives the real component the way a user does — typing in the search box and
 * changing a group's sort control — and asserts the rendered DOM order, so the wiring
 * between the pure helpers and the React shell is exercised end-to-end in a live DOM.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

function obj(
  partial: Partial<ContentObject> & { type: string; slug: string },
): ContentObject {
  return {
    kind: 'collection',
    path: `content/${partial.type}/${partial.slug}/index.md`,
    data: {},
    body: '',
    public: false,
    ...partial,
  };
}

const events: ContentTypeSchema = {
  name: 'events',
  kind: 'collection',
  fields: { title: { type: 'text' }, capacity: { type: 'number', label: 'Capacity' } },
};
const pages: ContentTypeSchema = { name: 'pages', kind: 'collection', fields: { title: { type: 'text' } } };
const schemas = new Map<string, ContentTypeSchema>([
  ['events', events],
  ['pages', pages],
]);

const OBJECTS: ContentObject[] = [
  obj({ type: 'events', slug: 'gala', data: { title: 'Gala', capacity: 200 } }),
  obj({ type: 'events', slug: 'meetup', data: { title: 'Meetup', capacity: 30 } }),
  obj({ type: 'events', slug: 'auction', data: { title: 'Auction', capacity: 90 } }),
  obj({ type: 'pages', slug: 'about', data: { title: 'About' } }),
];

function mount(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(ContentList, {
      objects: OBJECTS,
      schemas,
      selectedPath: '',
      editingPaths: new Set<string>(),
      savedPaths: new Set<string>(),
      deletedPaths: new Set<string>(),
      onSelect: () => undefined,
    }),
  );
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

async function waitFor<T>(fn: () => T | null | undefined, timeout = 4000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (performance.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

function set(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const groupNames = (): string[] =>
  [...document.querySelectorAll('.object-group__name')].map((n) => n.textContent?.trim().replace(/\d+$/, '').trim() ?? '');

const titlesIn = (groupIndex: number): string[] => {
  const group = document.querySelectorAll('.object-group')[groupIndex];
  return [...(group?.querySelectorAll('.object-list__title') ?? [])].map((t) => t.textContent ?? '');
};

describe('ContentList (rendered)', () => {
  it('renders groups by type, alphabetically, name-sorted by default', async () => {
    mount();
    await waitFor(() => document.querySelector('.object-group'));
    expect(groupNames()).toEqual(['events', 'pages']);
    // events group, sorted by name ascending
    expect(titlesIn(0)).toEqual(['Auction', 'Gala', 'Meetup']);
  });

  it('filters every group by the search box, case-insensitively', async () => {
    mount();
    const search = await waitFor(() =>
      document.querySelector<HTMLInputElement>('.object-list__search-input'),
    );
    set(search, 'a');
    await tick();
    // 'a' matches Gala, Auction (events) and About (pages)
    expect(titlesIn(0)).toEqual(['Auction', 'Gala']);
    expect(groupNames()).toEqual(['events', 'pages']);

    set(search, 'auction');
    await tick();
    expect(groupNames()).toEqual(['events']);
    expect(titlesIn(0)).toEqual(['Auction']);

    set(search, 'zzz');
    await tick();
    expect(document.querySelector('.object-list__empty')?.textContent).toBe('No matches.');
  });

  it('re-sorts a group by a numeric field when its sort control changes', async () => {
    mount();
    const select = await waitFor(() =>
      document.querySelector<HTMLSelectElement>('.object-group__sort-key'),
    );
    set(select, 'capacity');
    await tick();
    // ascending by capacity: Meetup(30), Auction(90), Gala(200)
    expect(titlesIn(0)).toEqual(['Meetup', 'Auction', 'Gala']);

    const dir = document.querySelector<HTMLButtonElement>('.object-group__sort-dir');
    dir?.click();
    await tick();
    // descending
    expect(titlesIn(0)).toEqual(['Gala', 'Auction', 'Meetup']);
  });
});

describe('ContentList (i18n clustering)', () => {
  const posts: ContentTypeSchema = {
    name: 'posts',
    kind: 'collection',
    fields: { title: { type: 'text' } },
  };
  const i18nSchemas = new Map<string, ContentTypeSchema>([['posts', posts]]);
  // One fully-translated group (en/fr/de) + one that only exists in English.
  const I18N_OBJECTS: ContentObject[] = [
    obj({ type: 'posts', slug: 'hello', lang: 'en', translationKey: 'G', public: true, data: { title: 'Hello' } }),
    obj({ type: 'posts', slug: 'bonjour', lang: 'fr', translationKey: 'G', public: false, data: { title: 'Bonjour' } }),
    obj({ type: 'posts', slug: 'hallo', lang: 'de', translationKey: 'G', public: true, data: { title: 'Hallo' } }),
    obj({ type: 'posts', slug: 'solo', lang: 'en', public: true, data: { title: 'Solo' } }),
  ];

  function mountI18n(): void {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      React.createElement(ContentList, {
        objects: I18N_OBJECTS,
        schemas: i18nSchemas,
        selectedPath: '',
        editingPaths: new Set<string>(),
        savedPaths: new Set<string>(),
        deletedPaths: new Set<string>(),
        onSelect: () => undefined,
        languages: ['en', 'fr', 'de'],
        defaultLanguage: 'en',
      }),
    );
  }

  const rowByTitle = (title: string): Element =>
    [...document.querySelectorAll('.object-list > li')].find((li) =>
      li.querySelector('.object-list__title')?.textContent?.includes(title),
    )!;

  it('collapses a translation set into one row and reads by the default language', async () => {
    mountI18n();
    await waitFor(() => document.querySelector('.object-group'));
    // Two rows: the en/fr/de group (rep = English "Hello") and the English-only "Solo".
    expect(titlesIn(0)).toEqual(['Hello', 'Solo']);
  });

  it('renders a chip per language — present as buttons, missing as muted gaps', async () => {
    mountI18n();
    await waitFor(() => document.querySelector('.object-list__langs'));

    const hello = rowByTitle('Hello');
    expect(hello.querySelectorAll('button.object-list__lang')).toHaveLength(3); // en, fr, de present
    expect(hello.querySelectorAll('.object-list__lang.is-missing')).toHaveLength(0);
    // The draft French variant is marked as such.
    expect(hello.querySelector('.object-list__lang.is-draft')?.textContent).toBe('fr');

    const solo = rowByTitle('Solo');
    expect(solo.querySelectorAll('button.object-list__lang')).toHaveLength(1); // en only
    expect([...solo.querySelectorAll('.object-list__lang.is-missing')].map((c) => c.textContent)).toEqual(
      ['fr', 'de'],
    );
  });

  it('“Needs translation” filter narrows to clusters with gaps', async () => {
    mountI18n();
    const filter = await waitFor(() =>
      document.querySelector<HTMLInputElement>('.object-list__filter input'),
    );
    filter.click();
    await tick();
    // "Hello" is fully translated → hidden; only the incomplete "Solo" remains.
    expect(titlesIn(0)).toEqual(['Solo']);
  });
});

describe('ContentList device-only surfacing (SPEC §5/§8)', () => {
  const rowByTitle = (title: string): Element =>
    [...document.querySelectorAll('.object-list > li')].find((li) =>
      li.querySelector('.object-list__title')?.textContent?.includes(title),
    )!;

  it('badges an On-this-device object distinctly and hides its Draft/Public badge', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      React.createElement(ContentList, {
        objects: OBJECTS,
        schemas,
        selectedPath: '',
        editingPaths: new Set<string>(),
        savedPaths: new Set<string>(),
        deletedPaths: new Set<string>(),
        deviceOnlyPaths: new Set(['content/events/gala/index.md']),
        onSelect: () => undefined,
      }),
    );
    await waitFor(() => document.querySelector('.object-group'));

    const gala = rowByTitle('Gala');
    // The device-only object carries the 💻 badge, not a change/visibility badge.
    expect(gala.querySelector('.cbadge--device')).not.toBeNull();
    expect(gala.querySelector('.vbadge')).toBeNull();

    // A normal (backed-up) object still shows its Draft/Public badge.
    const meetup = rowByTitle('Meetup');
    expect(meetup.querySelector('.cbadge--device')).toBeNull();
    expect(meetup.querySelector('.vbadge')).not.toBeNull();
  });
});
