import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { StaleDraftsBanner } from '../src/components/StaleDrafts.js';

// Tells React this is an act()-aware environment, so state updates flush synchronously
// and it doesn't warn on every render.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The set-aside banner (SPEC §5 base-SHA check). It exists because the alternative —
 * silently re-queueing a draft the branch has moved past — overwrote newer content three
 * times. It must name what was set aside and offer both ways out.
 */
let root: Root | null = null;
let host: HTMLElement | null = null;

function render(node: React.ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('StaleDraftsBanner', () => {
  it('names the page that was set aside and says the current version is showing', () => {
    const el = render(
      React.createElement(StaleDraftsBanner, {
        paths: ['content/projects/hunt-for-the-red-baron/index.md'],
        onRestore: () => undefined,
        onDiscard: () => undefined,
      }),
    );

    // The bundle name, not the raw path — the author knows the page by its slug.
    expect(el.textContent).toContain('hunt-for-the-red-baron');
    expect(el.textContent).toContain('current version');
    expect(el.textContent).not.toContain('index.md');
  });

  it('offers both ways out, and reports which was chosen', () => {
    const chosen: string[] = [];
    const el = render(
      React.createElement(StaleDraftsBanner, {
        paths: ['themes/anatole/templates/projects.liquid'],
        onRestore: () => chosen.push('restore'),
        onDiscard: () => chosen.push('discard'),
      }),
    );

    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Restore my draft', 'Discard it']);
    act(() => buttons[0]!.click());
    act(() => buttons[1]!.click());
    expect(chosen).toEqual(['restore', 'discard']);
  });

  it('lists every set-aside file when several are held', () => {
    const el = render(
      React.createElement(StaleDraftsBanner, {
        paths: ['content/posts/a/index.md', 'themes/anatole/templates/projects.liquid'],
        onRestore: () => undefined,
        onDiscard: () => undefined,
      }),
    );

    expect(el.textContent).toContain('a, projects.liquid');
    expect(el.querySelector('button')?.textContent).toBe('Restore my drafts');
  });
});
