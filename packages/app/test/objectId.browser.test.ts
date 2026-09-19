import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ObjectId } from '../src/components/ObjectId.js';

/** The read-only object id + copy button in the editor header (SPEC §5) — the handle
 *  an author pastes into `config/navigation.yml`, so copying it has to actually work. */

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(id: string): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(React.createElement(ObjectId, { id }));
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

describe('ObjectId (rendered)', () => {
  it('shows the id verbatim', async () => {
    mount('9f3c1a7e-2b41-4c8a-9d0e-5f6a7b8c9d0e');
    const code = await waitFor(() => document.querySelector('.object-id__value'));
    expect(code.textContent).toBe('9f3c1a7e-2b41-4c8a-9d0e-5f6a7b8c9d0e');
  });

  it('copies the id and confirms, then settles back', async () => {
    const copied: string[] = [];
    const clipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => void copied.push(t) },
      configurable: true,
    });

    try {
      mount('PAGE-HOME');
      const button = await waitFor(() => document.querySelector<HTMLButtonElement>('.object-id__copy'));
      button.click();
      await waitFor(() => (document.querySelector('.object-id__copy')?.textContent?.includes('Copied') ? true : null));
      expect(copied).toEqual(['PAGE-HOME']);
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    }
  });

  it('stays quiet when the clipboard is unavailable — the id is on screen anyway', async () => {
    const clipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
      configurable: true,
    });

    try {
      mount('PAGE-HOME');
      const button = await waitFor(() => document.querySelector<HTMLButtonElement>('.object-id__copy'));
      button.click();
      await new Promise((r) => setTimeout(r, 50));
      expect(button.textContent).toBe('Copy');
      expect(document.querySelector('.object-id__value')?.textContent).toBe('PAGE-HOME');
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    }
  });
});
