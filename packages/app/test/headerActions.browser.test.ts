import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HeaderActions } from '../src/components/HeaderActions.js';

/**
 * The per-page header actions must be **directly visible on desktop** — the regression was
 * that they lived in a `<details>` whose `<summary>` was CSS-hidden on desktop, so the
 * closed disclosure hid them with no way to open it. Desktop must therefore render NO
 * `<details>`/`<summary>` at all; the ⋯ disclosure is mobile-only.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

const baseProps = {
  canDiscard: true,
  isCollection: true,
  canAddTranslation: true,
  onDiscard: () => undefined,
  onAddTranslation: () => undefined,
  onRename: () => undefined,
  onDelete: () => undefined,
};

function mount(props: Partial<React.ComponentProps<typeof HeaderActions>> & { mobile: boolean }): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(React.createElement(HeaderActions, { ...baseProps, ...props }));
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('HeaderActions', () => {
  it('renders the buttons inline on desktop, with no <details> disclosure', async () => {
    mount({ mobile: false });
    await tick();
    // No disclosure at all → nothing can hide the buttons.
    expect(host!.querySelector('details')).toBeNull();
    expect(host!.querySelector('summary')).toBeNull();
    // The actions are present and directly in the DOM.
    expect(host!.querySelector('.editor-header__rename')).not.toBeNull();
    expect(host!.querySelector('.editor-header__delete')).not.toBeNull();
    expect(host!.querySelector('.editor-header__translate')).not.toBeNull();
  });

  it('collapses behind a ⋯ disclosure on mobile', async () => {
    mount({ mobile: true });
    await tick();
    const summary = host!.querySelector('summary.overflow-menu__toggle');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain('⋯');
    // The same actions still exist, inside the disclosure.
    expect(host!.querySelector('details .editor-header__rename')).not.toBeNull();
  });

  it('hides "Add translation" unless it applies', async () => {
    mount({ mobile: false, canAddTranslation: false });
    await tick();
    expect(host!.querySelector('.editor-header__translate')).toBeNull();
    // Rename/Delete still there.
    expect(host!.querySelector('.editor-header__rename')).not.toBeNull();
  });

  it('renders nothing for a singleton with no pending changes', async () => {
    mount({ mobile: false, canDiscard: false, isCollection: false });
    await tick();
    expect(host!.textContent).toBe('');
  });
});
