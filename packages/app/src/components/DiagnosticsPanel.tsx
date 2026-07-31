import { useEffect, useRef, useState } from 'react';
import { diagnostics, useDiagnostics, type DiagnosticEntry, type DiagnosticsLog } from '../state/diagnostics.js';

/**
 * The log behind "Save failed — <reason>" (SPEC §11). A retry loop that can't say what
 * it's retrying is undiagnosable by anyone without DevTools open *before* the failure,
 * so the header's Details button opens this: the recent failures with their status,
 * request id and host message, plus one button that copies the lot for a bug report.
 *
 * Everything shown here is already bounded and redacted by {@link DiagnosticsLog} — the
 * panel is a pure view over the ring buffer, holding no state of its own beyond which
 * rows are expanded.
 */

const LEVEL_GLYPH: Record<DiagnosticEntry['level'], string> = {
  info: 'ℹ',
  warn: '▲',
  error: '✕',
};

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface DiagnosticsPanelProps {
  onClose: () => void;
  /** Environment facts prepended to a copied dump (build, repo, branch) — for bug reports. */
  header?: Record<string, unknown> | undefined;
  /** Injectable for tests; defaults to the app-wide log. */
  log?: DiagnosticsLog;
}

export function DiagnosticsPanel({ onClose, header, log = diagnostics }: DiagnosticsPanelProps): React.JSX.Element {
  const entries = useDiagnostics(log);
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  // Same dismiss behaviour as the changes dropdown: Escape, or a pointer down outside
  // (but not on the Details button, which has its own toggle).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element | null;
      if (panelRef.current && !panelRef.current.contains(t) && !t?.closest?.('.changes__save')) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  const toggle = (seq: number): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });

  async function copyAll(): Promise<void> {
    const text = log.toText(header);
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied('idle'), 2000);
  }

  // Newest first: the failure you're looking at is the one that just happened.
  const rows = [...entries].reverse();
  const dropped = log.droppedCount();

  return (
    <div className="diag-panel" role="dialog" aria-label="Diagnostics" ref={panelRef}>
      <header className="diag-panel__head">
        <span>Diagnostics ({entries.length})</span>
        <div className="diag-panel__actions">
          <button type="button" className="diag-panel__btn" onClick={() => void copyAll()}>
            {copied === 'ok' ? 'Copied ✓' : copied === 'failed' ? 'Copy failed' : 'Copy'}
          </button>
          <button type="button" className="diag-panel__btn" onClick={() => log.clear()}>
            Clear
          </button>
          <button type="button" className="changes-panel__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="changes-panel__empty">Nothing logged this session.</p>
      ) : (
        <ul className="diag-panel__list">
          {rows.map((entry) => {
            const open = expanded.has(entry.seq);
            const hasDetail = entry.detail !== undefined;
            return (
              <li key={entry.seq} className={`diag-panel__item diag-panel__item--${entry.level}`}>
                <button
                  type="button"
                  className="diag-panel__row"
                  onClick={() => hasDetail && toggle(entry.seq)}
                  aria-expanded={hasDetail ? open : undefined}
                  disabled={!hasDetail}
                >
                  <span className={`diag-panel__glyph diag-panel__glyph--${entry.level}`} aria-hidden="true">
                    {LEVEL_GLYPH[entry.level]}
                  </span>
                  <time className="diag-panel__time" dateTime={new Date(entry.time).toISOString()}>
                    {formatTime(entry.time)}
                  </time>
                  <span className="diag-panel__scope">{entry.scope}</span>
                  <span className="diag-panel__msg">{entry.message}</span>
                  {hasDetail ? (
                    <span className="diag-panel__chevron" aria-hidden="true">
                      {open ? '▾' : '▸'}
                    </span>
                  ) : null}
                </button>
                {hasDetail && open ? (
                  <pre className="diag-panel__detail">{JSON.stringify(entry.detail, null, 2)}</pre>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <footer className="diag-panel__foot">
        Kept in this tab only, capped in size{dropped > 0 ? ` — ${dropped} older entries dropped` : ''}.
      </footer>
    </div>
  );
}
