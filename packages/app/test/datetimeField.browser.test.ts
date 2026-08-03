import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FieldWidget } from '../src/forms/widgets.js';
import type { FieldSchema } from '@timber/content';

/** Drives the `datetime` widget against a real `<input type="datetime-local">` — the
 *  control whose value grammar (no seconds, no zone) is what the stored RFC 3339 form
 *  has to be translated to and from. jsdom won't do: only a real browser applies the
 *  control's own value sanitisation, which is what silently emptied the box before. */

let root: Root | null = null;
let host: HTMLElement | null = null;

const datetimeField: FieldSchema = { type: 'datetime', label: 'Publish date' };

function mount(value: unknown): { changes: unknown[] } {
  const changes: unknown[] = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(FieldWidget, {
      fieldKey: 'date',
      field: datetimeField,
      value,
      onChange: (v: unknown) => changes.push(v),
    }),
  );
  return { changes };
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

function input(): Promise<HTMLInputElement> {
  return waitFor(() => document.querySelector<HTMLInputElement>('input[type="datetime-local"]'));
}

/** Set the control's value the way the browser does, so React's synthetic onChange fires. */
function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('datetime FieldWidget (rendered)', () => {
  it('shows a stored RFC 3339 value instead of an empty box', async () => {
    mount('2026-08-03T14:30:00Z');
    const el = await input();
    // The browser blanks any value it can't parse — the reason a saved date looked lost.
    expect(el.value).toBe('2026-08-03T14:30');
  });

  it('stores a picked date in the form the validator accepts', async () => {
    const { changes } = mount(undefined);
    const el = await input();
    expect(el.value).toBe('');
    type(el, '2026-08-03T14:30');
    expect(changes).toEqual(['2026-08-03T14:30:00Z']);
  });

  it('clears the field when the date is removed', async () => {
    const { changes } = mount('2026-08-03T14:30:00Z');
    const el = await input();
    type(el, '');
    expect(changes).toEqual([undefined]);
  });

  it('upgrades a zone-less value committed by the earlier widget', async () => {
    // Such a post shows the right date yet refuses to leave draft, and re-picking the
    // same minute fires no change event — so the widget has to do it.
    const { changes } = mount('2026-08-03T14:30');
    const el = await input();
    expect(el.value).toBe('2026-08-03T14:30');
    await waitFor(() => changes.length > 0);
    expect(changes).toEqual(['2026-08-03T14:30:00Z']);
  });

  it('leaves an already-valid value untouched on mount', async () => {
    const { changes } = mount('2026-08-03T14:30:00Z');
    await input();
    await new Promise((r) => setTimeout(r, 50));
    expect(changes).toEqual([]);
  });
});
