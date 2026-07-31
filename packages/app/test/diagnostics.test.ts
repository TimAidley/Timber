import { describe, expect, it, vi } from 'vitest';
import { DiagnosticsLog } from '../src/state/diagnostics.js';

/**
 * The log exists so "Save failed — retrying" is diagnosable, but it lives in a tab that
 * may be open all day — so the caps are the point, not a detail. These tests pin the two
 * independent bounds (entry count, total size), the per-entry clamp that stops one
 * monster evicting the history, and the redaction that keeps a token out of a dump the
 * user is invited to paste into a bug report.
 */

function makeLog(options = {}): DiagnosticsLog {
  return new DiagnosticsLog({ mirrorToConsole: false, ...options });
}

describe('DiagnosticsLog — bounds', () => {
  it('evicts the oldest entries beyond maxEntries', () => {
    const log = makeLog({ maxEntries: 5 });
    for (let i = 0; i < 12; i += 1) log.info('test', `entry ${i}`);

    const entries = log.entries();
    expect(entries).toHaveLength(5);
    expect(entries[0]!.message).toBe('entry 7');
    expect(entries[4]!.message).toBe('entry 11');
    expect(log.droppedCount()).toBe(7);
  });

  it('evicts on total size even when the entry count is fine', () => {
    const log = makeLog({ maxEntries: 1000, maxBytes: 2000, maxEntryBytes: 10_000 });
    for (let i = 0; i < 20; i += 1) log.info('test', 'x'.repeat(500));

    expect(log.entries().length).toBeLessThan(20);
    expect(log.size()).toBeLessThanOrEqual(2000);
    expect(log.droppedCount()).toBeGreaterThan(0);
  });

  it('truncates one oversized entry instead of letting it evict everything else', () => {
    const log = makeLog({ maxEntries: 50, maxBytes: 100_000, maxEntryBytes: 100 });
    log.info('test', 'small one');
    log.warn('test', 'y'.repeat(5000), { blob: 'z'.repeat(5000) });

    const [first, second] = log.entries();
    expect(log.entries()).toHaveLength(2); // the small one survived
    expect(first!.message).toBe('small one');
    expect(second!.message).toMatch(/\[truncated\]$/);
    expect(second!.message.length).toBeLessThan(200);
    expect(second!.detail).toMatchObject({ truncated: expect.any(Number) as unknown as number });
  });

  it('stays bounded under sustained failure — the retry-loop case', () => {
    const log = makeLog({ maxEntries: 200, maxBytes: 128 * 1024 });
    for (let i = 0; i < 5000; i += 1) {
      log.error('autosave', 'save to your branch failed', Object.assign(new Error('HTTP 401'), { status: 401 }));
    }
    expect(log.entries()).toHaveLength(200);
    expect(log.size()).toBeLessThanOrEqual(128 * 1024);
  });

  it('clear() empties the buffer and its accounting', () => {
    const log = makeLog();
    log.info('test', 'a');
    log.clear();
    expect(log.entries()).toHaveLength(0);
    expect(log.size()).toBe(0);
    expect(log.droppedCount()).toBe(0);
  });
});

describe('DiagnosticsLog — recording an error', () => {
  it('normalises a thrown host error into structured detail and returns the verdict', () => {
    const log = makeLog();
    const info = log.error(
      'autosave',
      'save to your branch failed',
      Object.assign(new Error('HTTP 401'), {
        status: 401,
        response: { status: 401, headers: { 'x-github-request-id': 'R1' }, data: { message: 'Bad credentials' } },
      }),
    );

    expect(info.kind).toBe('auth');
    expect(info.retryable).toBe(false);

    const entry = log.entries()[0]!;
    expect(entry.level).toBe('error');
    expect(entry.scope).toBe('autosave');
    expect(entry.detail).toMatchObject({
      kind: 'auth',
      status: 401,
      requestId: 'R1',
      hostMessage: 'Bad credentials',
      retryable: false,
    });
  });

  it('record() logs the same shape at a lower level for expected-but-worth-seeing failures', () => {
    const log = makeLog();
    log.record('warn', 'changes', 'could not compare branches', Object.assign(new Error('nope'), { status: 404 }));
    expect(log.entries()[0]!.level).toBe('warn');
    expect(log.entries()[0]!.detail).toMatchObject({ kind: 'not-found' });
  });

  it('survives an unserializable detail without throwing', () => {
    const log = makeLog();
    const circular: Record<string, unknown> = { name: 'loop' };
    circular['self'] = circular;
    expect(() => log.warn('test', 'circular detail', circular)).not.toThrow();
    expect(log.entries()).toHaveLength(1);
  });
});

describe('DiagnosticsLog — redaction', () => {
  it('redacts a token in a message, in detail, and in the copied dump', () => {
    const log = makeLog();
    log.warn('test', 'used ghp_0123456789abcdefghijABCDEFGHIJ', {
      header: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secretpayload',
      nested: { url: 'https://x/cb?access_token=hunter2hunter2&state=1' },
    });

    const dump = log.toText();
    for (const secret of ['ghp_0123456789', 'secretpayload', 'hunter2hunter2']) {
      expect(log.entries()[0]!.message + JSON.stringify(log.entries()[0]!.detail)).not.toContain(secret);
      expect(dump).not.toContain(secret);
    }
  });
});

describe('DiagnosticsLog — subscription + dump', () => {
  it('notifies subscribers and hands out a fresh snapshot each write', () => {
    const log = makeLog();
    const listener = vi.fn();
    const unsubscribe = log.subscribe(listener);

    const before = log.entries();
    log.info('test', 'one');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(log.entries()).not.toBe(before); // new identity → React re-renders

    unsubscribe();
    log.info('test', 'two');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('toText() writes a header, the drop count, and one line per entry', () => {
    const log = makeLog({ maxEntries: 2 });
    log.info('load', 'first');
    log.warn('autosave', 'second');
    log.error('autosave', 'third', new TypeError('Failed to fetch'));

    const text = log.toText({ repo: 'owner/site', branch: 'me_wip' });
    expect(text).toContain('repo: owner/site');
    expect(text).toContain('branch: me_wip');
    expect(text).toContain('(+1 older dropped)');
    expect(text).not.toContain('first'); // evicted
    expect(text).toMatch(/WARN \[autosave\] second/);
    expect(text).toMatch(/ERROR \[autosave\] third/);
    expect(text).toContain('"kind":"network"');
  });
});
