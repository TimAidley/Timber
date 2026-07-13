import { computeLineDiff, type DiffRow } from './computeDiff.js';

interface DiffViewProps {
  /** The published (old) text, or null if the file didn't exist yet (all additions). */
  base: string | null;
  /** The current (new) text. */
  working: string;
  /** Fetching the base — show a placeholder instead of an empty (misleading) diff. */
  loading?: boolean;
  error?: string | null;
  /** Message shown when base and working are identical. */
  emptyLabel?: string;
}

const SIGN: Record<DiffRow['type'], string> = { add: '+', del: '−', context: ' ', fold: '' };

/**
 * A read-only unified line diff of `base` → `working`, styled with the app's own
 * tokens (theme-aware, no third-party diff CSS). Computation is jsdiff via
 * {@link computeLineDiff}; this component is pure presentation, so both the body /
 * advanced Diff tabs (live in-memory text) and {@link PathDiff} (fetched branch
 * text) render through the same surface. Raw text only — no rich-text rendering
 * (SPEC §8: the diff is over the canonical Markdown / YAML source).
 */
export function DiffView({ base, working, loading, error, emptyLabel }: DiffViewProps): React.JSX.Element {
  if (loading) return <div className="diff-view diff-view--status">Loading changes…</div>;
  if (error) return <div className="diff-view diff-view--status diff-view--error">{error}</div>;

  const { rows, added, removed } = computeLineDiff(base, working);
  if (added === 0 && removed === 0) {
    return <div className="diff-view diff-view--status">{emptyLabel ?? 'No changes.'}</div>;
  }

  return (
    <div className="diff-view">
      <div className="diff-view__summary">
        <span className="diff-view__stat diff-view__stat--add">+{added}</span>
        <span className="diff-view__stat diff-view__stat--del">−{removed}</span>
      </div>
      <div
        className="diff-view__body"
        role="group"
        aria-label={`Diff: ${added} added, ${removed} removed line${removed === 1 ? '' : 's'}`}
      >
        {rows.map((row, i) => (
          <DiffLine key={i} row={row} />
        ))}
      </div>
    </div>
  );
}

function DiffLine({ row }: { row: DiffRow }): React.JSX.Element {
  if (row.type === 'fold') {
    return (
      <div className="diff-row diff-row--fold">
        <span className="diff-row__text">
          ⋯ {row.count} unchanged line{row.count === 1 ? '' : 's'}
        </span>
      </div>
    );
  }
  return (
    <div className={`diff-row diff-row--${row.type}`}>
      <span className="diff-row__sign" aria-hidden="true">
        {SIGN[row.type]}
      </span>
      {/* Non-breaking space keeps a blank line from collapsing to zero height. */}
      <span className="diff-row__text">{row.text || ' '}</span>
    </div>
  );
}
