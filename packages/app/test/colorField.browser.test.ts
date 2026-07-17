import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FieldWidget } from '../src/forms/widgets.js';
import type { FieldSchema } from '@timber/content';

/** Drives the `color` field widget in a live DOM: the picker, the "theme default" empty
 *  state, and the Clear affordance that returns the value to undefined. */

let root: Root | null = null;
let host: HTMLElement | null = null;

const colorField: FieldSchema = { type: 'color', label: 'Accent colour' };

function mount(value: unknown): { changes: unknown[] } {
  const changes: unknown[] = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(FieldWidget, {
      fieldKey: 'accentColor',
      field: colorField,
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

describe('color FieldWidget (rendered)', () => {
  it('shows a picker and "theme default" when unset', async () => {
    mount(undefined);
    const input = await waitFor(() =>
      document.querySelector<HTMLInputElement>('input[type="color"]'),
    );
    expect(input).not.toBeNull();
    expect(document.querySelector('.color-field__hint')?.textContent).toMatch(
      /theme default/i,
    );
    // No hex label and no Clear button until a value is chosen.
    expect(document.querySelector('.color-field__clear')).toBeNull();
  });

  it('shows the hex value and a working Clear when set', async () => {
    const { changes } = mount('#3457d5');
    const clear = await waitFor(() =>
      document.querySelector<HTMLButtonElement>('.color-field__clear'),
    );
    expect(document.querySelector('.color-field code')?.textContent).toBe('#3457d5');
    clear.click();
    expect(changes).toEqual([undefined]);
  });

  it('emits the chosen colour on input', async () => {
    const { changes } = mount(undefined);
    const input = await waitFor(() =>
      document.querySelector<HTMLInputElement>('input[type="color"]'),
    );
    // React tracks the input's value internally, so set it through the native setter
    // (not `input.value =`) for the synthetic onChange to fire.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, '#ff0000');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changes).toContain('#ff0000');
  });
});
