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
  assetStore?: AssetStore;
}): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(BodyEditor, {
      docKey: 0,
      assetStore: props.assetStore ?? new AssetStore(),
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

  it('undoes and redoes a toolbar edit via the Undo/Redo buttons', async () => {
    let latest = 'hello';
    mount({ value: 'hello', onChange: (md) => (latest = md) });
    await waitFor(() => (btn('Undo') && !btn('Undo')!.disabled ? true : null));
    expect(btn('Redo')).toBeTruthy();

    // Make a change we can undo (wrap the whole paragraph in a heading).
    focusEditorAtEnd();
    press('Heading 1');
    await waitFor(() => (latest.trim() === '# hello' ? true : null));

    // Undo returns to the original markdown; redo re-applies the heading. These are
    // the buttons a mobile user relies on, where there is no Ctrl+Z.
    press('Undo');
    await waitFor(() => (latest.trim() === 'hello' ? true : null));
    expect(latest.trim()).toBe('hello');

    press('Redo');
    await waitFor(() => (latest.trim() === '# hello' ? true : null));
    expect(latest.trim()).toBe('# hello');
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

  it('contains floated figures (editable establishes a block formatting context)', async () => {
    mount({ value: 'hi', onChange: () => {} });
    const pm = await waitFor(() =>
      document.querySelector<HTMLElement>('.body-editor .ProseMirror'),
    );
    // Without a BFC a wrapped (floated) figure spills below the editor box.
    expect(getComputedStyle(pm).display).toBe('flow-root');
  });

  it('exposes an Image button on the toolbar', async () => {
    mount({ value: 'hello', onChange: () => {} });
    await waitFor(() => (btn('Bold') ? true : null));
    expect(btn('Image')).toBeTruthy();
  });

  it('renders a :::figure as a live NodeView with an image, caption and controls', async () => {
    const store = new AssetStore();
    store.stage('media/cat.webp', new Blob(['x'], { type: 'image/webp' }));
    const md = [
      ':::figure{layout="center" size="sm"}',
      '![A cat](media/cat.webp)',
      '',
      'A wild _cat_.',
      ':::',
      '',
    ].join('\n');
    mount({ value: md, onChange: () => {}, assetStore: store });

    const figure = await waitFor(() =>
      document.querySelector<HTMLElement>('.body-editor .figure-node'),
    );
    expect(figure.classList.contains('fig--center')).toBe(true);
    expect(figure.classList.contains('fig--sm')).toBe(true);
    const img = await waitFor(() => figure.querySelector('img'));
    expect(img.getAttribute('alt')).toBe('A cat');
    expect(figure.querySelector('figcaption')?.textContent).toContain('cat');
    // Layout + size controls are present.
    expect(figure.querySelector('button[title="Wrap right"]')).toBeTruthy();
    expect(figure.querySelector('button[title="Large"]')).toBeTruthy();
  });

  it('labels an empty caption with a placeholder so it is discoverable', async () => {
    const store = new AssetStore();
    store.stage('media/x.webp', new Blob(['x'], { type: 'image/webp' }));
    mount({
      value: ':::figure{layout="center"}\n![Alt](media/x.webp)\n:::\n',
      onChange: () => {},
      assetStore: store,
    });
    const cap = await waitFor(() =>
      document.querySelector<HTMLElement>('.figure-node figcaption'),
    );
    expect(cap.getAttribute('data-empty')).toBe('true');
    expect(cap.getAttribute('data-placeholder')).toBe('Add a caption…');
  });

  it('does not flag a populated caption as empty', async () => {
    const store = new AssetStore();
    store.stage('media/x.webp', new Blob(['x'], { type: 'image/webp' }));
    mount({
      value: ':::figure\n![Alt](media/x.webp)\n\nReal caption.\n:::\n',
      onChange: () => {},
      assetStore: store,
    });
    const cap = await waitFor(() => {
      const c = document.querySelector<HTMLElement>('.figure-node figcaption');
      return c?.textContent?.includes('Real caption') ? c : null;
    });
    expect(cap.hasAttribute('data-empty')).toBe(false);
  });

  it('lazily re-fetches a committed image after reload (empty store + loader)', async () => {
    // Simulates a reload: nothing staged in memory, but the loader can fetch the
    // committed bytes from the branch — the NodeView should resolve to an <img>.
    let asked: string | undefined;
    const store = new AssetStore(async (path) => {
      asked = path;
      return new Blob(['bytes'], { type: 'image/webp' });
    });
    const md = ':::figure{layout="wrap-left"}\n![A dog](media/dog.webp)\n:::\n';
    mount({ value: md, onChange: () => {}, assetStore: store });

    const img = await waitFor(() =>
      document.querySelector<HTMLImageElement>('.figure-node img'),
    );
    expect(asked).toBe('media/dog.webp');
    expect(img.getAttribute('src')).toMatch(/^blob:/);
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
