import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseNavigation, type ContentModel, type ContentObject, type ContentTypeSchema } from '@timber/content';
import { NavEditor } from '../src/advanced/NavEditor.js';

/** Drives the site menu editor (SPEC §13) in a live DOM: the rows it renders from
 *  `config/navigation.yml`, the advisory warning on an entry whose target is gone,
 *  reordering, removal, and the YAML each of those writes back. */

let root: Root | null = null;
let host: HTMLElement | null = null;

function schema(name: string, page = true): ContentTypeSchema {
  return { name, kind: 'collection', fields: {}, ...(page ? {} : { page: false }) } as ContentTypeSchema;
}

function object(id: string, title: string): ContentObject {
  return {
    type: 'pages',
    kind: 'collection',
    id,
    slug: id.toLowerCase(),
    path: `content/pages/${id.toLowerCase()}/index.md`,
    data: { id, title },
    body: '',
    public: true,
  };
}

const model: ContentModel = {
  schemas: new Map([['pages', schema('pages')]]),
  objects: [object('PAGE-HOME', 'Home'), object('PAGE-ABOUT', 'About')],
  byId: new Map([
    ['PAGE-HOME', object('PAGE-HOME', 'Home')],
    ['PAGE-ABOUT', object('PAGE-ABOUT', 'About')],
  ]),
  byTranslation: new Map(),
  errors: [],
};

function mount(value: string): { writes: string[] } {
  const writes: string[] = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(NavEditor, {
      value,
      model,
      onChange: (next: string) => writes.push(next),
    }),
  );
  return { writes };
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

const rows = (): NodeListOf<HTMLLIElement> => document.querySelectorAll<HTMLLIElement>('.nav-editor__row');

describe('NavEditor (rendered)', () => {
  it('renders a row per authored entry, showing the target page by title not by id', async () => {
    mount('- label: Home\n  ref: PAGE-HOME\n- label: Blog\n  url: /blog/\n');
    await waitFor(() => (rows().length === 2 ? true : null));

    const [first, second] = [...rows()];
    expect(first?.querySelector<HTMLInputElement>('.nav-editor__label input')?.value).toBe('Home');
    // The page picker displays the title; the id stays in the file.
    expect(first?.querySelector<HTMLInputElement>('.reference-field input')?.value).toBe('Home');
    expect(second?.querySelector<HTMLInputElement>('.nav-editor__url')?.value).toBe('/blog/');
  });

  it('shows an empty state when there is no menu yet', async () => {
    mount('[]\n');
    await waitFor(() => document.querySelector('.nav-editor__empty'));
    expect(rows().length).toBe(0);
  });

  it('flags an entry whose page has been deleted, without blocking anything', async () => {
    mount('- label: Gone\n  ref: PAGE-DELETED\n');
    const problems = await waitFor(() => document.querySelector('.nav-editor__problems'));
    expect(problems.textContent).toMatch(/points at a missing object/i);
    // Advisory only: the row still renders and stays editable.
    expect(rows().length).toBe(1);
  });

  it('flags an entry with no target and one with no label', async () => {
    mount('- label: Nowhere\n- url: /x/\n');
    await waitFor(() => (document.querySelectorAll('.nav-editor__problems').length === 2 ? true : null));
    const texts = [...document.querySelectorAll('.nav-editor__problems')].map((n) => n.textContent ?? '');
    expect(texts[0]).toMatch(/no page or URL/i);
    expect(texts[1]).toMatch(/no label/i);
  });

  it('reorders an entry and writes the new order back as YAML', async () => {
    const { writes } = mount('- label: Home\n  ref: PAGE-HOME\n- label: Blog\n  url: /blog/\n');
    const down = await waitFor(() =>
      rows()[0]?.querySelector<HTMLButtonElement>('[aria-label="Move Home down"]'),
    );
    down.click();
    expect(parseNavigation(writes[0] as string)).toEqual([
      { label: 'Blog', url: '/blog/' },
      { label: 'Home', ref: 'PAGE-HOME' },
    ]);
  });

  it('disables moving past either end', async () => {
    mount('- label: Home\n  ref: PAGE-HOME\n- label: Blog\n  url: /blog/\n');
    await waitFor(() => (rows().length === 2 ? true : null));
    expect(rows()[0]?.querySelector<HTMLButtonElement>('[aria-label="Move Home up"]')?.disabled).toBe(true);
    expect(rows()[1]?.querySelector<HTMLButtonElement>('[aria-label="Move Blog down"]')?.disabled).toBe(true);
  });

  it('removes an entry', async () => {
    const { writes } = mount('- label: Home\n  ref: PAGE-HOME\n- label: Blog\n  url: /blog/\n');
    const remove = await waitFor(() =>
      rows()[0]?.querySelector<HTMLButtonElement>('[aria-label="Remove Home"]'),
    );
    remove.click();
    expect(parseNavigation(writes[0] as string)).toEqual([{ label: 'Blog', url: '/blog/' }]);
  });

  it('appends a page row and a link row', async () => {
    const { writes } = mount('[]\n');
    const buttons = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLButtonElement>('.nav-editor__add button')];
      return found.length === 2 ? found : null;
    });
    buttons[0]?.click();
    expect(parseNavigation(writes[0] as string)).toEqual([{ label: '' }]);
    buttons[1]?.click();
    expect(parseNavigation(writes[1] as string)).toEqual([{ label: '', url: '' }]);
  });

  it('switches a row from a page to a URL, dropping the ref so it carries only one target', async () => {
    const { writes } = mount('- label: Home\n  ref: PAGE-HOME\n');
    const urlBtn = await waitFor(() => {
      const kinds = rows()[0]?.querySelectorAll<HTMLButtonElement>('.nav-editor__kind-btn');
      return kinds?.[1];
    });
    urlBtn.click();
    expect(parseNavigation(writes[0] as string)).toEqual([{ label: 'Home', url: '' }]);
  });
});
