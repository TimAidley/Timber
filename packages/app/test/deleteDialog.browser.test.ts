import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseNavigation, type ContentModel, type ContentObject, type ContentTypeSchema } from '@timber/content';
import { DeleteDialog } from '../src/components/DeleteDialog.js';

/** The guarded-delete warning (SPEC §5), specifically its navigation half: deleting a
 *  page that's in the site menu must say so — `referrersTo` sweeps schema reference
 *  fields and can't see `config/navigation.yml`. */

let root: Root | null = null;
let host: HTMLElement | null = null;

function schema(name: string, fields: ContentTypeSchema['fields'] = {}): ContentTypeSchema {
  return { name, kind: 'collection', fields } as ContentTypeSchema;
}

function object(type: string, id: string, title: string, data: Record<string, unknown> = {}): ContentObject {
  return {
    type,
    kind: 'collection',
    id,
    slug: id.toLowerCase(),
    path: `content/${type}/${id.toLowerCase()}/index.md`,
    data: { id, title, ...data },
    body: '',
    public: true,
  };
}

const home = object('pages', 'PAGE-HOME', 'Home');

function model(objects: ContentObject[], schemas: ContentTypeSchema[] = [schema('pages')]): ContentModel {
  return {
    schemas: new Map(schemas.map((s) => [s.name, s])),
    objects,
    byId: new Map(objects.map((o) => [o.id as string, o])),
    byTranslation: new Map(),
    errors: [],
  };
}

function mount(m: ContentModel, navigation: ReturnType<typeof parseNavigation>): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(DeleteDialog, {
      object: home,
      model: m,
      navigation,
      onClose: () => {},
      onConfirm: () => {},
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

describe('DeleteDialog navigation guard (rendered)', () => {
  it('warns, naming the menu entry, when the object is linked from the site menu', async () => {
    mount(model([home]), parseNavigation('- label: Home\n  ref: PAGE-HOME\n'));
    const warning = await waitFor(() => document.querySelector('.delete__referrers'));
    expect(warning.textContent).toMatch(/in the site menu/i);
    expect(warning.textContent).toContain('Home');
    // The nav warning must displace the "nothing references this" reassurance.
    expect(document.body.textContent).not.toMatch(/Nothing references this object/i);
  });

  it('still says nothing references it when the menu points elsewhere', async () => {
    mount(model([home]), parseNavigation('- label: Blog\n  url: /blog/\n'));
    await waitFor(() => (document.body.textContent?.match(/Nothing references this object/i) ? true : null));
    expect(document.querySelector('.delete__referrers')).toBeNull();
  });

  it('shows both warnings when a field and the menu each point at it', async () => {
    const referrer = object('pages', 'PAGE-EVENT', 'Summer fête', { venue: 'PAGE-HOME' });
    const m = model(
      [home, referrer],
      [schema('pages', { venue: { type: 'reference', referenceType: 'pages' } })],
    );
    mount(m, parseNavigation('- label: Home\n  ref: PAGE-HOME\n'));
    await waitFor(() => (document.querySelectorAll('.delete__referrers').length === 2 ? true : null));
    const texts = [...document.querySelectorAll('.delete__referrers')].map((n) => n.textContent ?? '');
    expect(texts[0]).toMatch(/still reference this one/i);
    expect(texts[1]).toMatch(/in the site menu/i);
  });
});
