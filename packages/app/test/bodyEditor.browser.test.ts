import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BodyEditor } from '../src/editor/BodyEditor.js';
import { AssetStore } from '../src/state/assets.js';
import '@milkdown/kit/prose/view/style/prosemirror.css';
import '../src/styles.css';

/**
 * The body editor's toolbar drives real Milkdown commands and the padding fix is a
 * computed-style concern — both need a live DOM + layout, so this runs in headless
 * Chromium (`pnpm test:browser`) rather than jsdom.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(props: {
  value: string;
  onChange: (md: string) => void;
  docKey?: number;
}): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(BodyEditor, {
      docKey: 0,
      assetStore: new AssetStore(),
      bundleDir: 'content/pages/home',
      ...props,
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
    await new Promise((r) => setTimeout(r, 25));
  }
}

const btn = (label: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`.body-toolbar__btn[aria-label="${label}"]`);

/** Click a toolbar button the way a user does — mousedown (preventDefault) then click. */
function press(label: string): void {
  const b = btn(label);
  if (!b) throw new Error(`no toolbar button: ${label}`);
  b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** Place the caret inside the ProseMirror editable at the end of its content. */
function focusEditorAtEnd(): void {
  const pm = document.querySelector<HTMLElement>('.body-editor .ProseMirror');
  if (!pm) throw new Error('no ProseMirror element');
  pm.focus();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(pm);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

describe('BodyEditor toolbar + tabs (real browser)', () => {
  it('renders the editor tab by default with a formatting toolbar', async () => {
    mount({ value: 'hello', onChange: () => {} });
    await waitFor(() => (btn('Bold') && !btn('Bold')!.disabled ? true : null));

    expect(document.querySelector('.body-toolbar')).toBeTruthy();
    // A representative spread of the actions is present.
    for (const label of ['Bold', 'Italic', 'Heading 1', 'Bullet list', 'Quote', 'Divider', 'Table']) {
      expect(btn(label), `button ${label}`).toBeTruthy();
    }
  });

  it('applies a block command from the toolbar and reports canonical markdown', async () => {
    let latest = 'hello';
    mount({ value: 'hello', onChange: (md) => (latest = md) });
    await waitFor(() => (btn('Heading 1') && !btn('Heading 1')!.disabled ? true : null));

    focusEditorAtEnd();
    press('Heading 1');
    await waitFor(() => (latest.startsWith('#') ? true : null));
    expect(latest.trim()).toBe('# hello');
  });

  it('applies a mark command to the selected text', async () => {
    let latest = 'hello';
    mount({ value: 'hello', onChange: (md) => (latest = md) });
    await waitFor(() => (btn('Bold') && !btn('Bold')!.disabled ? true : null));

    const pm = document.querySelector<HTMLElement>('.body-editor .ProseMirror')!;
    pm.focus();
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(pm);
    sel.removeAllRanges();
    sel.addRange(range);
    // Let ProseMirror pick up the DOM selection before we run the command.
    await new Promise((r) => setTimeout(r, 50));

    press('Bold');
    await waitFor(() => (latest.includes('**') ? true : null));
    expect(latest.trim()).toBe('**hello**');
  });

  it('inserts a horizontal rule via the toolbar', async () => {
    let latest = 'hello';
    mount({ value: 'hello', onChange: (md) => (latest = md) });
    await waitFor(() => (btn('Divider') && !btn('Divider')!.disabled ? true : null));

    focusEditorAtEnd();
    press('Divider');
    await waitFor(() => (latest.includes('---') ? true : null));
    expect(latest).toContain('---');
  });

  it('switches to the Markdown tab, showing the raw source in a textarea', async () => {
    mount({ value: '# Title\n\nBody text', onChange: () => {} });
    await waitFor(() => (btn('Bold') ? true : null));

    const sourceTab = [...document.querySelectorAll<HTMLButtonElement>('.body-editor__tab')].find(
      (t) => t.textContent === 'Markdown',
    );
    expect(sourceTab).toBeTruthy();
    sourceTab!.click();

    const textarea = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>('.body-editor__source'),
    );
    expect(textarea.value).toBe('# Title\n\nBody text');
    // Milkdown is unmounted while on the Markdown tab.
    expect(document.querySelector('.body-toolbar')).toBeNull();
  });

  it('gives the editable left padding so the caret is not flush to the edge', async () => {
    mount({ value: '', onChange: () => {} });
    const pm = await waitFor(() =>
      document.querySelector<HTMLElement>('.body-editor .ProseMirror'),
    );
    const padLeft = parseFloat(getComputedStyle(pm).paddingLeft);
    expect(padLeft).toBeGreaterThanOrEqual(6);
  });

  it('exposes an Image button on the toolbar', async () => {
    mount({ value: 'hello', onChange: () => {} });
    await waitFor(() => (btn('Bold') ? true : null));
    expect(btn('Image')).toBeTruthy();
  });

  it('renders a :::figure as a live NodeView with an image, caption and controls', async () => {
    const md = [
      ':::figure{layout="center" size="sm"}',
      '![A cat](media/cat.webp)',
      '',
      'A wild _cat_.',
      ':::',
      '',
    ].join('\n');
    mount({ value: md, onChange: () => {} });

    const figure = await waitFor(() =>
      document.querySelector<HTMLElement>('.body-editor .figure-node'),
    );
    expect(figure.classList.contains('fig--center')).toBe(true);
    expect(figure.classList.contains('fig--sm')).toBe(true);
    expect(figure.querySelector('img')?.getAttribute('alt')).toBe('A cat');
    expect(figure.querySelector('figcaption')?.textContent).toContain('cat');
    // Layout + size controls are present.
    expect(figure.querySelector('button[title="Wrap right"]')).toBeTruthy();
    expect(figure.querySelector('button[title="Large"]')).toBeTruthy();
  });

  it('edits figure layout from the NodeView and re-serializes canonically', async () => {
    let latest = '';
    const md = [':::figure', '![A cat](media/cat.webp)', '', 'Caption.', ':::', ''].join('\n');
    mount({ value: md, onChange: (m) => (latest = m) });

    const wrapBtn = await waitFor(() =>
      document.querySelector<HTMLButtonElement>('.figure-node__bar button[title="Wrap right"]'),
    );
    wrapBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    wrapBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await waitFor(() => (latest.includes('layout="wrap-right"') ? true : null));
    expect(latest).toContain(':::figure{layout="wrap-right"}');
    expect(latest).toContain('![A cat](media/cat.webp)');
    expect(latest).toContain('Caption.');
  });
});
