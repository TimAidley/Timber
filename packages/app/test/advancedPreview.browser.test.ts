import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AdvancedPreview } from '../src/advanced/AdvancedPreview.js';
import type { RepoSession } from '../src/state/repoSession.js';

/**
 * The style specimen: `AdvancedPreview` with a `style` file must render a sandboxed
 * iframe whose document carries the *edited* CSS applied to the default theme's own
 * markup (`.site-header`, `.page`, …). The frame is opaque-origin (sandbox="") so the
 * parent can't read into it — we assert on the `srcDoc` the component builds, which is
 * what the browser then renders. `session` is unused on the style path (a cast keeps
 * the test free of GitHub plumbing).
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(css: string): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(AdvancedPreview, {
      session: {} as unknown as RepoSession,
      kind: 'style',
      template: css,
      valid: true,
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

describe('AdvancedPreview — style specimen (rendered)', () => {
  it('renders a specimen iframe carrying the edited CSS over the theme markup', async () => {
    const css = '.site-title { color: rgb(1, 2, 3); }';
    mount(css);
    const frame = await waitFor(() =>
      document.querySelector<HTMLIFrameElement>('iframe.advanced__frame'),
    );
    expect(frame.title).toBe('Style specimen');
    const doc = frame.getAttribute('srcdoc') ?? '';
    // The author's edited CSS is injected...
    expect(doc).toContain(css);
    // ...over the default theme's own selectors, so real rules take effect.
    expect(doc).toContain('class="site-header"');
    expect(doc).toContain('class="page"');
  });
});
