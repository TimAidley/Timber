import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FieldWidget } from '../src/forms/widgets.js';
import type { FieldSchema } from '@timber/content';

/**
 * Drives the `tags` field widget in a live DOM the way SchemaForm does — **controlled**,
 * re-rendering with each emitted value. This is the exact scenario that broke: typing a
 * comma or space produced a parsed array, the box re-derived its text from that array, and
 * the separator you just typed vanished — so you could never type more than one tag.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

const tagsField: FieldSchema = { type: 'tags', label: 'Languages' };

/** Mount controlled: each onChange feeds the emitted value back as the new `value` prop. */
function mountControlled(initial: unknown): { changes: unknown[] } {
  const changes: unknown[] = [];
  let current = initial;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const render = (): void =>
    root!.render(
      React.createElement(FieldWidget, {
        fieldKey: 'languages',
        field: tagsField,
        value: current,
        onChange: (v: unknown) => {
          changes.push(v);
          current = v;
          render();
        },
      }),
    );
  render();
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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

/** Set the input's value through React's native setter so the synthetic onChange fires. */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('tags FieldWidget (rendered, controlled)', () => {
  it('lets you type a comma separator without it being stripped', async () => {
    const { changes } = mountControlled(undefined);
    const input = await waitFor(() =>
      document.querySelector<HTMLInputElement>('input[type="text"]'),
    );

    typeInto(input, 'en');
    await tick();
    typeInto(input, 'en,'); // the separator that used to disappear
    await tick();
    expect(input.value).toBe('en,'); // comma survives (regression guard)

    typeInto(input, 'en, fr');
    await tick();
    expect(input.value).toBe('en, fr'); // space survives too
    expect(changes.at(-1)).toEqual(['en', 'fr']); // model got the parsed array
  });

  it('shows an existing array as comma-separated text', async () => {
    mountControlled(['en', 'fr', 'de']);
    const input = await waitFor(() =>
      document.querySelector<HTMLInputElement>('input[type="text"]'),
    );
    expect(input.value).toBe('en, fr, de');
  });

  it('emits the parsed tags array as you type', async () => {
    const { changes } = mountControlled(undefined);
    const input = await waitFor(() =>
      document.querySelector<HTMLInputElement>('input[type="text"]'),
    );
    typeInto(input, 'en, fr, de');
    await tick();
    expect(changes.at(-1)).toEqual(['en', 'fr', 'de']);
  });
});
