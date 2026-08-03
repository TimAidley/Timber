import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UpdateBanner } from '../src/components/UpdateBanner.js';
import { PublishButton } from '../src/components/ChangeBadges.js';
import type { DeployProgressView } from '../src/state/deploy.js';

/**
 * Build progress in the update banner (SPEC §12). The behaviour worth pinning here is
 * **accessibility**, because it's the part that's invisible in review: the banner is a
 * `role="status"` live region, so anything that ticks inside it gets announced. A
 * countdown re-announcing every few seconds would make the banner hostile to a screen
 * reader — so the readout is `aria-hidden` and the progress is exposed as a queryable
 * `progressbar` instead, with the live region's own sentence held fixed.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(progress?: DeployProgressView): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    React.createElement(UpdateBanner, {
      behindBy: 3,
      phase: 'updating',
      ...(progress ? { progress } : {}),
      onUpdate: () => undefined,
      onReload: () => undefined,
    }),
  );
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

const running: DeployProgressView = {
  phase: 'running',
  fraction: 0.4,
  remaining: 'about 2 minutes left',
  label: 'Build the site',
};

describe('UpdateBanner build progress', () => {
  it('promises no duration when the host cannot measure one', async () => {
    mount();
    await tick();
    // The bug this feature fixes: the banner used to assert "about a minute" to every
    // site regardless of what its build actually took.
    expect(host!.textContent).not.toMatch(/minute/i);
    expect(host!.querySelector('[role="progressbar"]')).toBeNull();
    expect(host!.textContent).toContain('Rebuilding with the latest Timber');
  });

  it('shows the ETA and fills the bar to the elapsed fraction', async () => {
    mount(running);
    await tick();
    const bar = host!.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('aria-valuetext')).toBe(
      'Build the site — about 2 minutes left',
    );
    expect((bar.querySelector('.deploy-progress__fill') as HTMLElement).style.width).toBe(
      '40%',
    );
    expect(host!.textContent).toContain('Build the site — about 2 minutes left');
  });

  it('keeps the ticking readout out of the live region', async () => {
    mount(running);
    await tick();
    const readout = host!.querySelector('.deploy-progress__text')!;
    expect(readout.getAttribute('aria-hidden')).toBe('true');
    // The bar sits inside the same live region, so it must opt out too — it carries the
    // same text as aria-valuetext, available on demand rather than announced.
    expect(host!.querySelector('[role="progressbar"]')!.getAttribute('aria-live')).toBe(
      'off',
    );
  });

  it('holds the announced sentence steady while progress changes', async () => {
    mount(running);
    await tick();
    const announced = host!.querySelector('.update-banner__text')!.textContent;
    root!.render(
      React.createElement(UpdateBanner, {
        behindBy: 3,
        phase: 'updating',
        progress: { ...running, fraction: 0.8, remaining: 'less than a minute left' },
        onUpdate: () => undefined,
        onReload: () => undefined,
      }),
    );
    await tick();
    expect(host!.querySelector('.update-banner__text')!.textContent).toBe(announced);
    expect(host!.textContent).toContain('less than a minute left');
  });

  it('drops aria-valuenow entirely when there is no honest number', async () => {
    // ARIA spells "indeterminate" as an absent value, not as zero.
    mount({
      phase: 'queued',
      fraction: undefined,
      remaining: undefined,
      label: undefined,
    });
    await tick();
    const bar = host!.querySelector('[role="progressbar"]')!;
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getAttribute('aria-valuetext')).toBe('Queued — waiting for a runner');
    expect(bar.className).toContain('deploy-progress--queued');
  });

  it('marks an overrun build so the bar can sweep instead of freezing', async () => {
    mount({
      phase: 'overrun',
      fraction: undefined,
      remaining: undefined,
      label: 'Deploy to GitHub Pages',
    });
    await tick();
    const bar = host!.querySelector('[role="progressbar"]')!;
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.className).toContain('deploy-progress--overrun');
    expect(host!.textContent).toContain(
      'Deploy to GitHub Pages — taking longer than usual',
    );
  });
});

/**
 * The Publish button's build phase shows the same progress, but it has no room for a bar
 * of its own — so it *becomes* one, via a CSS custom property behind its label. The
 * button's size and label must not change mid-build, or the header would reflow every
 * time the poll returned.
 */
describe('PublishButton build progress', () => {
  function mountButton(progress?: DeployProgressView): HTMLButtonElement {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      React.createElement(PublishButton, {
        phase: 'building',
        hasChanges: true,
        ...(progress ? { progress } : {}),
        onPublish: () => undefined,
      }),
    );
    return host.querySelector('button')!;
  }

  it('sizes the fill from the elapsed fraction and keeps the ETA in the tooltip', async () => {
    mountButton(running);
    await tick();
    const button = host!.querySelector('button')!;
    expect(button.style.getPropertyValue('--publish-progress')).toBe('40%');
    expect(button.getAttribute('title')).toBe('Build the site — about 2 minutes left');
    // The label is the one thing that must not move — a button whose text changed every
    // five seconds would be its own distraction.
    expect(button.textContent).toContain('Building…');
  });

  it('sets no fill when there is no honest fraction', async () => {
    mountButton({
      phase: 'queued',
      fraction: undefined,
      remaining: undefined,
      label: undefined,
    });
    await tick();
    const button = host!.querySelector('button')!;
    expect(button.style.getPropertyValue('--publish-progress')).toBe('');
    expect(button.getAttribute('title')).toBe('Queued — waiting for a runner');
  });

  it('looks exactly as it always did on a host with no progress support', async () => {
    mountButton();
    await tick();
    const button = host!.querySelector('button')!;
    expect(button.style.getPropertyValue('--publish-progress')).toBe('');
    expect(button.hasAttribute('title')).toBe(false);
    expect(button.textContent).toContain('Building…');
  });
});
