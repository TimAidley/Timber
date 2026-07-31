import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DiagnosticsPanel } from '../src/components/DiagnosticsPanel.js';
import { DiagnosticsLog } from '../src/state/diagnostics.js';

/** The panel is a pure view over the ring buffer — newest first, details on demand. */

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(log: DiagnosticsLog): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(React.createElement(DiagnosticsPanel, { onClose: () => undefined, log }));
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

describe('DiagnosticsPanel', () => {
  it('lists the newest failure first, with its scope and message', async () => {
    const log = new DiagnosticsLog({ mirrorToConsole: false });
    log.info('load', 'opened the repo');
    log.error('autosave', 'save to your branch failed', Object.assign(new Error('x'), { status: 401 }));
    mount(log);
    await tick();

    const rows = [...host!.querySelectorAll('.diag-panel__row')];
    expect(rows[0]!.textContent).toContain('save to your branch failed');
    expect(rows[0]!.textContent).toContain('autosave');
    expect(rows[1]!.textContent).toContain('opened the repo');
  });

  it('expands an entry to the structured detail a bug report needs', async () => {
    const log = new DiagnosticsLog({ mirrorToConsole: false });
    log.error(
      'autosave',
      'save to your branch failed',
      Object.assign(new Error('x'), {
        status: 401,
        response: { status: 401, headers: { 'x-github-request-id': 'REQ-7' }, data: { message: 'Bad credentials' } },
      }),
    );
    mount(log);
    await tick();

    expect(host!.querySelector('.diag-panel__detail')).toBeNull();
    host!.querySelector<HTMLButtonElement>('.diag-panel__row')!.click();
    await tick();

    const detail = host!.querySelector('.diag-panel__detail')!.textContent ?? '';
    expect(detail).toContain('"kind": "auth"');
    expect(detail).toContain('REQ-7');
    expect(detail).toContain('Bad credentials');
  });

  it('reports dropped history rather than pretending it has everything', async () => {
    const log = new DiagnosticsLog({ mirrorToConsole: false, maxEntries: 2 });
    for (let i = 0; i < 5; i += 1) log.warn('test', `entry ${i}`);
    mount(log);
    await tick();

    expect(host!.querySelector('.diag-panel__foot')!.textContent).toContain('3 older entries dropped');
  });

  it('clears the log live', async () => {
    const log = new DiagnosticsLog({ mirrorToConsole: false });
    log.warn('test', 'something');
    mount(log);
    await tick();

    [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Clear')!.click();
    await tick();

    expect(host!.querySelectorAll('.diag-panel__row')).toHaveLength(0);
    expect(host!.textContent).toContain('Nothing logged this session.');
  });
});
