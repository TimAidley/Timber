import { diffLines, type Change } from 'diff';

/**
 * One rendered line of a unified diff.
 *   add     — a line present only in the new (working) text
 *   del     — a line present only in the old (published) text
 *   context — an unchanged line kept for orientation
 *   fold    — a collapsed run of unchanged lines ("⋯ N unchanged lines")
 */
export type DiffRowType = 'add' | 'del' | 'context' | 'fold';

export interface DiffRow {
  type: DiffRowType;
  /** The line text (never includes the trailing newline). Empty for a `fold`. */
  text: string;
  /** For a `fold`, how many unchanged lines it stands in for. */
  count?: number;
}

export interface DiffResult {
  rows: DiffRow[];
  /** Added / removed **line** counts, for the "+X −Y" summary. */
  added: number;
  removed: number;
}

/** Split a jsdiff chunk value into lines, dropping the trailing empty from a final `\n`. */
function toLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Collapse long runs of unchanged `context` rows into a single `fold`, keeping
 * `context` lines of orientation on each side of every change. A run only folds
 * when it's long enough that folding actually hides something (more than
 * `2 * context + 1` lines), so small gaps between edits stay expanded.
 */
function foldContext(rows: DiffRow[], context: number): DiffRow[] {
  const changedAt = rows.map((r) => r.type === 'add' || r.type === 'del');
  // keep[i] = this context row is close enough to a change to stay visible.
  const keep = rows.map((r, i) => {
    if (r.type !== 'context') return true;
    for (let d = -context; d <= context; d++) {
      if (changedAt[i + d]) return true;
    }
    return false;
  });

  const out: DiffRow[] = [];
  let hidden = 0;
  for (let i = 0; i < rows.length; i++) {
    if (keep[i]) {
      if (hidden > 0) {
        out.push({ type: 'fold', text: '', count: hidden });
        hidden = 0;
      }
      out.push(rows[i]!);
    } else {
      hidden += 1;
    }
  }
  if (hidden > 0) out.push({ type: 'fold', text: '', count: hidden });
  return out;
}

/**
 * Compute a line-level unified diff of `base` → `working` for display. Built on
 * jsdiff's `diffLines` (the locked diff-compute dependency), then flattened to
 * one {@link DiffRow} per line and context-folded for readability. A null `base`
 * (the file didn't exist yet — a brand-new object/file) diffs against the empty
 * string, so every line reads as an addition.
 */
export function computeLineDiff(
  base: string | null,
  working: string,
  opts: { context?: number } = {},
): DiffResult {
  const context = opts.context ?? 3;
  const changes: Change[] = diffLines(base ?? '', working);

  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    const type: DiffRowType = change.added ? 'add' : change.removed ? 'del' : 'context';
    for (const line of toLines(change.value)) {
      rows.push({ type, text: line });
      if (type === 'add') added += 1;
      else if (type === 'del') removed += 1;
    }
  }

  return { rows: foldContext(rows, context), added, removed };
}
