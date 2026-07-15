import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AssetManager } from '../src/advanced/AssetManager.js';
import { AssetStore } from '../src/state/assets.js';
import type { SiteAsset } from '../src/media/siteAssets.js';
import '../src/styles.css';

/**
 * Drives the asset manager in a live DOM: rendering the grid, rejecting a disallowed
 * upload through the real file input, and the guarded delete flow. The image-processing
 * path (worker → WebP) is covered by the pure policy tests + reencode.browser; here we
 * exercise the component wiring that doesn't need the worker.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

const FONT: SiteAsset = {
  path: 'assets/fonts/serif.woff2',
  name: 'serif.woff2',
  ext: 'woff2',
  size: 5000,
  category: 'font',
};

function mount(props: Partial<React.ComponentProps<typeof AssetManager>> = {}): {
  onStage: string[];
  onDelete: string[][];
} {
  const onStage: string[] = [];
  const onDelete: string[][] = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(AssetManager, {
      initialAssets: [FONT],
      assetStore: new AssetStore(),
      sources: [],
      onStage: (p) => onStage.push(p),
      onDelete: (p) => onDelete.push(p),
      ...props,
    }),
  );
  return { onStage, onDelete };
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

describe('AssetManager (rendered)', () => {
  it('lists existing assets with name and type', async () => {
    mount();
    const card = await waitFor(() => document.querySelector('.asset-card'));
    expect(card.querySelector('.asset-card__name')?.textContent).toBe('serif.woff2');
    expect(card.querySelector('.asset-card__sub')?.textContent).toMatch(/Font/);
    // A non-image renders as a tile with its extension, not an <img>.
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.asset-card__ext')?.textContent).toBe('woff2');
  });

  it('rejects a disallowed upload with a helpful message and no staging', async () => {
    const { onStage } = mount();
    const input = await waitFor(() =>
      document.querySelector<HTMLInputElement>('input[type="file"]'),
    );
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'malware.exe', { type: 'application/octet-stream' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const err = await waitFor(() => document.querySelector('.asset-manager__error'));
    expect(err.textContent).toMatch(/\.exe/);
    expect(onStage).toEqual([]); // nothing staged for a rejected file
  });

  it('confirms then deletes an asset, calling back with its path', async () => {
    const { onDelete } = mount();
    const del = await waitFor(() =>
      document.querySelector<HTMLButtonElement>('.asset-card__delete'),
    );
    del.click();

    const dialog = await waitFor(() => document.querySelector('[role="dialog"]'));
    expect(dialog.textContent).toMatch(/Delete serif\.woff2/);
    const confirm = dialog.querySelector<HTMLButtonElement>('button.is-danger');
    confirm?.click();

    await waitFor(() => (document.querySelector('.asset-card') ? null : true));
    expect(onDelete).toEqual([['assets/fonts/serif.woff2']]);
  });
});
