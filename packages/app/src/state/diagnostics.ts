import { useSyncExternalStore } from 'react';
import { describeHostError, redactSecrets, type HostErrorInfo } from '@timber/host';

/**
 * A bounded, in-memory diagnostics log — the answer to "*Save failed — retrying*, but
 * why?" (SPEC §11). Failures used to leave exactly one trace: a `console.warn` you had
 * to have DevTools open to catch, gone on the next reload, and invisible to anyone who
 * isn't a developer. This keeps the last few minutes of failures where the UI can show
 * them and the user can copy them into a bug report.
 *
 * **Bounded twice, deliberately.** A log that can grow without limit in a long editing
 * session is a memory leak with good intentions, and one runaway error (a giant host
 * response) can otherwise evict all the useful history on its own. So: a cap on the
 * number of entries, a cap on total serialized size, and a per-entry cap that truncates
 * a single monster rather than letting it push everything else out.
 *
 * **In memory only, on purpose.** Nothing here is persisted to IndexedDB or
 * `localStorage`: the failure that matters repeats on every retry (so it's live when you
 * look), and a log that can contain host responses is the last thing that should be
 * written to disk next to a token (SPEC §9). Secrets are redacted on the way in anyway —
 * belt and braces.
 */

export type DiagnosticLevel = 'info' | 'warn' | 'error';

export interface DiagnosticEntry {
  /** Monotonic per-log sequence number — a stable React key, and shows dropped entries. */
  seq: number;
  /** Epoch ms; formatted at render time. */
  time: number;
  level: DiagnosticLevel;
  /** Which subsystem spoke: `autosave`, `publish`, `deploy`, `load`, `assets`. */
  scope: string;
  message: string;
  /** Structured extras (status, request id, host message…). Already redacted + clamped. */
  detail?: Record<string, unknown>;
}

export interface DiagnosticsLogOptions {
  /** Hard cap on retained entries (default 200). */
  maxEntries?: number;
  /** Hard cap on total retained size in characters (default 128 KiB). */
  maxBytes?: number;
  /** Per-entry cap; a bigger entry is truncated, not dropped (default 2 KiB). */
  maxEntryBytes?: number;
  /** Mirror entries to the console so DevTools still works (default true). */
  mirrorToConsole?: boolean;
}

const DEFAULTS = {
  maxEntries: 200,
  maxBytes: 128 * 1024,
  maxEntryBytes: 2 * 1024,
  mirrorToConsole: true,
} as const;

/** JSON that never throws on cycles, `BigInt`, or exotic values. */
function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key, v: unknown) => {
        if (typeof v === 'bigint') return `${v}n`;
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[circular]';
          seen.add(v);
        }
        return v;
      }) ?? String(value)
    );
  } catch {
    return '[unserializable]';
  }
}

/** Redact every string in a detail object, bounded in depth so a deep graph can't stall us. */
function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (depth >= 4 || typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, depth + 1);
  return out;
}

function sizeOf(entry: DiagnosticEntry): number {
  return entry.scope.length + entry.message.length + (entry.detail ? safeJson(entry.detail).length : 0) + 48;
}

export class DiagnosticsLog {
  private readonly opts: Required<DiagnosticsLogOptions>;
  private items: DiagnosticEntry[] = [];
  private bytes = 0;
  private nextSeq = 1;
  /** Entries evicted since the log started — so a dump can say history was dropped. */
  private dropped = 0;
  private listeners = new Set<() => void>();

  constructor(options: DiagnosticsLogOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  add(level: DiagnosticLevel, scope: string, message: string, detail?: Record<string, unknown>): void {
    const entry: DiagnosticEntry = {
      seq: this.nextSeq++,
      time: Date.now(),
      level,
      scope,
      message: redactSecrets(message),
      ...(detail ? { detail: redactDeep(detail) as Record<string, unknown> } : {}),
    };
    this.clamp(entry);
    this.items.push(entry);
    this.bytes += sizeOf(entry);
    this.evict();
    this.items = [...this.items]; // fresh identity for useSyncExternalStore
    if (this.opts.mirrorToConsole) mirror(entry);
    for (const listener of this.listeners) listener();
  }

  info(scope: string, message: string, detail?: Record<string, unknown>): void {
    this.add('info', scope, message, detail);
  }

  warn(scope: string, message: string, detail?: Record<string, unknown>): void {
    this.add('warn', scope, message, detail);
  }

  /**
   * Record a thrown value against a scope, normalised through the host port so the
   * entry carries the status/kind/request-id rather than just a stringified object.
   * Returns the {@link HostErrorInfo} so a caller can drive the UI off the same verdict.
   */
  error(scope: string, message: string, err: unknown): HostErrorInfo {
    return this.record('error', scope, message, err);
  }

  /**
   * {@link error} at an explicit level — for a failure that's *expected* in some
   * situations (a branch-compare before the first save) but still worth recording,
   * since the same catch also swallows the genuine failures.
   */
  record(level: DiagnosticLevel, scope: string, message: string, err: unknown): HostErrorInfo {
    const info = describeHostError(err);
    this.add(level, scope, message, {
      kind: info.kind,
      reason: info.reason,
      retryable: info.retryable,
      hostMessage: info.message,
      ...(info.status !== undefined ? { status: info.status } : {}),
      ...(info.requestId !== undefined ? { requestId: info.requestId } : {}),
      ...(info.retryAfterSec !== undefined ? { retryAfterSec: info.retryAfterSec } : {}),
      ...(err instanceof Error && err.stack ? { at: err.stack.split('\n')[1]?.trim() ?? '' } : {}),
    });
    return info;
  }

  /** Truncate one oversized entry in place rather than letting it evict the history. */
  private clamp(entry: DiagnosticEntry): void {
    const limit = this.opts.maxEntryBytes;
    if (entry.message.length > limit) {
      entry.message = `${entry.message.slice(0, limit)}… [truncated]`;
    }
    if (!entry.detail) return;
    const json = safeJson(entry.detail);
    if (json.length > limit) {
      entry.detail = { truncated: json.length, detail: `${json.slice(0, limit)}…` };
    }
  }

  private evict(): void {
    while (this.items.length > this.opts.maxEntries || this.bytes > this.opts.maxBytes) {
      const oldest = this.items.shift();
      if (!oldest) break;
      this.bytes -= sizeOf(oldest);
      this.dropped += 1;
    }
    if (this.items.length === 0) this.bytes = 0; // guard against drift
  }

  /** Newest-last snapshot; stable identity until the next write (safe for React). */
  entries(): readonly DiagnosticEntry[] {
    return this.items;
  }

  /** How many entries have been evicted by the caps. */
  droppedCount(): number {
    return this.dropped;
  }

  /** Approximate retained size in characters — for tests and the panel's footer. */
  size(): number {
    return this.bytes;
  }

  clear(): void {
    this.items = [];
    this.bytes = 0;
    this.dropped = 0;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A plain-text dump for the panel's "Copy" — what we want pasted into a bug report. */
  toText(header?: Record<string, unknown>): string {
    const lines: string[] = ['Timber diagnostics'];
    if (header) {
      for (const [k, v] of Object.entries(header)) lines.push(`${k}: ${redactSecrets(String(v))}`);
    }
    lines.push(`entries: ${this.items.length}${this.dropped > 0 ? ` (+${this.dropped} older dropped)` : ''}`);
    lines.push('');
    for (const e of this.items) {
      const time = new Date(e.time).toISOString();
      lines.push(
        `${time} ${e.level.toUpperCase()} [${e.scope}] ${e.message}${e.detail ? ` ${safeJson(e.detail)}` : ''}`,
      );
    }
    return lines.join('\n');
  }
}

function mirror(entry: DiagnosticEntry): void {
  const line = `[timber] ${entry.scope}: ${entry.message}`;
  const args: unknown[] = entry.detail ? [line, entry.detail] : [line];
  if (entry.level === 'error') console.error(...args);
  else if (entry.level === 'warn') console.warn(...args);
  else console.info(...args);
}

/** The app-wide log. One per tab; the panel and every failure path share it. */
export const diagnostics = new DiagnosticsLog();

/**
 * Expose the log on `window` so it's reachable from the console in a production build
 * (`__timber.diagnostics.toText()`), where the panel might not be open when it matters.
 * Read-only handle — nothing here can change app state.
 */
export function installDiagnosticsHandle(log: DiagnosticsLog = diagnostics): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)['__timber'] = {
    diagnostics: log,
    dump: () => log.toText(),
  };
}

/** Subscribe a component to the log. */
export function useDiagnostics(log: DiagnosticsLog = diagnostics): readonly DiagnosticEntry[] {
  return useSyncExternalStore(
    (onChange) => log.subscribe(onChange),
    () => log.entries(),
    () => log.entries(),
  );
}
