import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ForeignChangesBanner, ForeignChangesDialog } from '../src/components/ForeignChanges.js';
import type { ForeignChange } from '../src/state/foreignChanges.js';

/**
 * The warning has to distinguish the two cases the user asked about: another tab
 * touching *different* files (informational — "your work isn't affected") from one
 * touching a file you're editing (your next save silently overwrites theirs).
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(el: React.ReactElement): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(el);
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

const change = (overlapping: boolean): ForeignChange => ({
  sha: 'bbbbbbbbbbbb',
  baseSha: 'aaaaaaaaaaaa',
  paths: [{ path: 'content/pages/home/index.md', status: 'modified', overlapping }],
});

describe('ForeignChangesBanner', () => {
  it('reassures when nothing you are editing was touched', async () => {
    mount(
      React.createElement(ForeignChangesBanner, {
        change: change(false),
        onReview: () => undefined,
        onDismiss: () => undefined,
      }),
    );
    await tick();

    expect(host!.textContent).toContain('Another tab or device saved 1 change');
    expect(host!.textContent).toContain('Your work isn’t affected');
    expect(host!.querySelector('.foreign-banner--clash')).toBeNull();
  });

  it('warns, and names the file, when your save would overwrite theirs', async () => {
    const onReview = vi.fn();
    mount(
      React.createElement(ForeignChangesBanner, {
        change: change(true),
        onReview,
        onDismiss: () => undefined,
      }),
    );
    await tick();

    const text = host!.textContent ?? '';
    expect(text).toContain('home');
    expect(text).toContain('will overwrite their version');
    expect(host!.querySelector('.foreign-banner--clash')).not.toBeNull();

    [...host!.querySelectorAll('button')].find((b) => b.textContent === 'See what changed')!.click();
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed', async () => {
    const onDismiss = vi.fn();
    mount(
      React.createElement(ForeignChangesBanner, {
        change: change(false),
        onReview: () => undefined,
        onDismiss,
      }),
    );
    await tick();
    [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Dismiss')!.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('ForeignChangesDialog', () => {
  it('opens the clashing file’s diff straight away — their version vs the one you started from', async () => {
    const readFile = vi.fn(async (_path: string, ref: string) =>
      ref === 'aaaaaaaaaaaa' ? 'title: Home\n' : 'title: Home page\n',
    );
    mount(
      React.createElement(ForeignChangesDialog, {
        change: change(true),
        client: { readFile },
        onClose: () => undefined,
      }),
    );
    await tick();

    // Expanded without a click, because it's the row that needs a decision.
    expect(host!.querySelector('.foreign-dialog__diff')).not.toBeNull();
    expect(readFile.mock.calls.map((c) => c[1]).sort()).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
    expect(host!.textContent).toContain('also editing here');
  });

  it('leaves a non-clashing file collapsed until asked', async () => {
    const readFile = vi.fn(async () => 'x');
    mount(
      React.createElement(ForeignChangesDialog, {
        change: change(false),
        client: { readFile },
        onClose: () => undefined,
      }),
    );
    await tick();

    expect(host!.querySelector('.foreign-dialog__diff')).toBeNull();
    expect(readFile).not.toHaveBeenCalled();

    host!.querySelector<HTMLButtonElement>('.foreign-dialog__row')!.click();
    await tick();
    expect(host!.querySelector('.foreign-dialog__diff')).not.toBeNull();
  });
});
