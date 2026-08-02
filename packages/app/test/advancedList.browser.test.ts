import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AdvancedList } from '../src/advanced/AdvancedList.js';
import type { AdvancedFile } from '../src/advanced/loadAdvancedFiles.js';
import '../src/styles.css';

/**
 * The grouping rules are unit-tested in `advancedList.test.ts`; this spec drives the
 * real component in a live DOM and asserts the rendered group headings + per-group
 * file order, so the wiring between the pure helper and the React shell is exercised
 * end-to-end — the same way `contentList.browser.test.ts` covers the content list.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

function file(path: string, kind: AdvancedFile['kind']): AdvancedFile {
  return { path, kind, content: '' };
}

const FILES: AdvancedFile[] = [
  file('templates/default.liquid', 'template'),
  file('assets/theme.css', 'style'),
  file('config/schemas/pages.yml', 'schema'),
  file('config/schemas/settings.yml', 'schema'),
  file('config/navigation.yml', 'config'),
];

function mount(
  selectedPath = '',
  editingPaths: ReadonlySet<string> = new Set(),
  savedPaths: ReadonlySet<string> = new Set(),
): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(AdvancedList, {
      files: FILES,
      selectedPath,
      editingPaths,
      savedPaths,
      onSelect: () => undefined,
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

const groupNames = (): string[] =>
  [...document.querySelectorAll('.object-group__name')].map(
    (n) => n.textContent?.trim().replace(/\d+$/, '').trim() ?? '',
  );

const titlesIn = (groupIndex: number): string[] => {
  const group = document.querySelectorAll('.object-group')[groupIndex];
  return [...(group?.querySelectorAll('.object-list__title') ?? [])].map(
    (t) => t.textContent ?? '',
  );
};

describe('AdvancedList (rendered)', () => {
  it('groups files by kind under Templates → Styles → Schemas → Config headings', async () => {
    mount();
    await waitFor(() => document.querySelector('.object-group'));
    expect(groupNames()).toEqual(['Templates', 'Styles', 'Schemas', 'Config']);
    expect(titlesIn(0)).toEqual(['default.liquid']);
    expect(titlesIn(1)).toEqual(['theme.css']);
    expect(titlesIn(2)).toEqual(['pages.yml', 'settings.yml']);
    expect(titlesIn(3)).toEqual(['navigation.yml']);
  });

  // An advanced-area edit is unsaved for as long as the autosave debounce lasts, and
  // without a badge the row looked identical to a published file for those seconds —
  // the one place the editor said nothing about work it was still holding.
  it('badges an edited file Editing and a committed one Saved', async () => {
    mount('', new Set(['assets/theme.css']), new Set(['config/navigation.yml']));
    await waitFor(() => document.querySelector('.cbadge'));

    const badgeFor = (name: string): Element | null | undefined =>
      [...document.querySelectorAll('.object-list__title')]
        .find((t) => t.textContent?.includes(name))
        ?.querySelector('.cbadge');

    expect(badgeFor('theme.css')?.className).toContain('cbadge--editing');
    expect(badgeFor('navigation.yml')?.className).toContain('cbadge--saved');
    expect(badgeFor('default.liquid')).toBeNull(); // clean → no badge
  });

  it('marks the selected file active', async () => {
    mount('config/schemas/settings.yml');
    const active = await waitFor(() =>
      document.querySelector<HTMLButtonElement>('.object-list button.is-active'),
    );
    expect(active.querySelector('.object-list__title')?.textContent).toBe('settings.yml');
  });
});
