import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describeHostError } from '@timber/host';
import { ChangesSummary } from '../src/components/ChangeBadges.js';

/**
 * The header's error state used to say only "Save failed — retrying" — true of a dropped
 * connection, a lie for an expired session (which fails identically forever). It must
 * now name the cause and, when a retry cannot possibly work, offer the action that can.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

const baseProps = {
  editing: 1,
  saved: 0,
  deleting: 0,
  device: 0,
  onSaveNow: () => undefined,
};

function hostError(status: number, message: string): unknown {
  return Object.assign(new Error(`HTTP ${status}`), {
    status,
    response: { status, headers: {}, data: { message } },
  });
}

function mount(props: Partial<React.ComponentProps<typeof ChangesSummary>>): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(React.createElement(ChangesSummary, { ...baseProps, syncState: 'error', ...props }));
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

describe('ChangesSummary — save failure', () => {
  it('names the cause and the fix instead of just "Save failed"', async () => {
    mount({ saveError: describeHostError(hostError(403, 'You have exceeded a secondary rate limit')) });
    await tick();

    const text = host!.textContent ?? '';
    expect(text).toContain('Save failed — rate limited by the host (403)');
    expect(text).toContain('retrying'); // a rate limit does clear on its own
    expect(host!.querySelector('.changes--error')?.getAttribute('title')).toMatch(/resumes automatically/);
  });

  it('offers "Sign in again" — not a doomed retry — when the session expired', async () => {
    const onSignIn = vi.fn();
    mount({ saveError: describeHostError(hostError(401, 'Bad credentials')), onSignIn });
    await tick();

    const text = host!.textContent ?? '';
    expect(text).toContain('signed out (401)');
    expect(text).not.toContain('retrying'); // it would never succeed — don't promise it
    const button = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Sign in again');
    expect(button).toBeDefined();
    button!.click();
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('falls back to "Save now" when the cause is fixable by retrying', async () => {
    mount({ saveError: describeHostError(new TypeError('Failed to fetch')), onSignIn: () => undefined });
    await tick();

    expect(host!.textContent).toContain('no connection to the host');
    expect([...host!.querySelectorAll('button')].map((b) => b.textContent)).toContain('Save now');
  });

  it('opens the diagnostics log from a Details button', async () => {
    const onShowDiagnostics = vi.fn();
    mount({ saveError: describeHostError(hostError(500, 'Server Error')), onShowDiagnostics });
    await tick();

    const details = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Details');
    expect(details).toBeDefined();
    details!.click();
    expect(onShowDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('keeps the old wording when the cause is unknown', async () => {
    mount({});
    await tick();
    expect(host!.textContent).toContain('Save failed, retrying');
  });

  it('announces the failure to assistive tech', async () => {
    mount({ saveError: describeHostError(hostError(401, 'Bad credentials')) });
    await tick();
    expect(host!.querySelector('[role="status"]')).not.toBeNull();
  });
});
