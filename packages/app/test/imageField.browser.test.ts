import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ImageField } from '../src/forms/ImageField.js';
import { AssetStore } from '../src/state/assets.js';

/**
 * The `image` field widget's two coordinate systems (SPEC §4/§7): what it **stores** is
 * relative to the object's bundle, because the build copies a bundle's files flat next to
 * the page it renders; what it **stages and looks up** is the repo path everything else —
 * asset store, autosave, git — keys on. Storing the repo path put a src on the published
 * page that resolves to `/pages/home/content/pages/home/images/…` and 404s.
 *
 * Runs in real Chromium (`pnpm test:browser`) because uploading drives the actual
 * `createImageBitmap → OffscreenCanvas → WebP` pipeline, which jsdom cannot execute.
 */

const BUNDLE = 'content/pages/home';

let root: Root | null = null;
let host: HTMLElement | null = null;

interface Mounted {
  paths: (string | undefined)[];
  staged: string[];
}

function mount(props: { value?: unknown; assetStore: AssetStore }): Mounted {
  const paths: (string | undefined)[] = [];
  const staged: string[] = [];
  let current = props.value;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const render = (): void =>
    root!.render(
      React.createElement(ImageField, {
        fieldKey: 'poster',
        value: current,
        alt: 'A poster',
        onChangePath: (p: string | undefined) => {
          paths.push(p);
          current = p;
          render();
        },
        onChangeAlt: () => {},
        assetStore: props.assetStore,
        bundleDir: BUNDLE,
        onStaged: (p: string) => staged.push(p),
      }),
    );
  render();
  return { paths, staged };
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

async function waitFor<T>(fn: () => T | null | undefined, timeout = 8000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (performance.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A real PNG, so the upload runs the genuine decode/re-encode path. */
async function makePng(w: number, h: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  // A gradient, so WebP genuinely beats the original and the pipeline re-encodes
  // (a flat fill compresses better as PNG and would be kept as-is).
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#c0392b');
  grad.addColorStop(1, '#2b6cb0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/png',
    ),
  );
}

/** Drop a file on the widget's `<input type="file">` the way the picker does. */
function pickFile(file: File): void {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ImageField (real browser)', () => {
  it('stores the bundle-relative path and stages the repo path', async () => {
    const store = new AssetStore();
    const { paths, staged } = mount({ assetStore: store });

    pickFile(new File([await makePng(1200, 900)], 'My Photo.PNG', { type: 'image/png' }));

    await waitFor(() => (paths.length > 0 ? true : null));
    // The value written into `index.md` — what a template's `<img src>` resolves against
    // the page, not the repo path the editor used to write.
    expect(paths.at(-1)).toBe('images/my-photo.webp');
    // The bytes are staged (and autosave notified) under the repo path git commits to.
    expect(staged).toEqual([`${BUNDLE}/images/my-photo.webp`]);
    expect(store.urlFor(`${BUNDLE}/images/my-photo.webp`)).toBeTruthy();

    // And the widget shows the stored value + a thumbnail of the staged bytes.
    const img = await waitFor(() =>
      document.querySelector<HTMLImageElement>('.image-field__preview img'),
    );
    expect(img.getAttribute('src')).toMatch(/^blob:/);
    expect(document.querySelector('.image-field__preview code')?.textContent).toBe(
      'images/my-photo.webp',
    );
  });

  it('re-fetches a committed image by repo path after a reload', async () => {
    // Nothing staged in memory (a fresh load), so the store asks its loader — with the
    // repo path, mapped back from the bundle-relative value the field holds.
    let asked: string | undefined;
    const store = new AssetStore(async (path) => {
      asked = path;
      return new Blob(['bytes'], { type: 'image/webp' });
    });
    mount({ value: 'images/poster.webp', assetStore: store });

    const img = await waitFor(() =>
      document.querySelector<HTMLImageElement>('.image-field__preview img'),
    );
    expect(asked).toBe(`${BUNDLE}/images/poster.webp`);
    expect(img.getAttribute('src')).toMatch(/^blob:/);
  });

  it('still displays the repo paths older content stored', async () => {
    const store = new AssetStore();
    store.stage(`${BUNDLE}/images/old.webp`, new Blob(['x'], { type: 'image/webp' }));
    mount({ value: `${BUNDLE}/images/old.webp`, assetStore: store });

    const img = await waitFor(() =>
      document.querySelector<HTMLImageElement>('.image-field__preview img'),
    );
    expect(img.getAttribute('src')).toMatch(/^blob:/);
  });
});
