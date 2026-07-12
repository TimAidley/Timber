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
