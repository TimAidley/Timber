import { useEffect, useRef, useState } from 'react';
import type { ChangeState } from '../state/changes.js';
import { PathDiff } from '../diff/PathDiff.js';
import type { RefTextClient } from '../diff/useRefText.js';

/** One changed item in the header changes panel. */
export interface ChangeEntry {
  /** The repo path to diff (an object's `index.md`, or a template/config file path). */
  path: string;
  /** Human label (page title / file name). */
  title: string;
  /** What kind of thing changed — drives the small type tag. */
  kind: 'content' | 'template' | 'schema' | 'config' | 'asset';
  state: Exclude<ChangeState, 'clean'>;
  /** Jump to this item in the editor (selects it, closes the panel). */
  onOpen?: (() => void) | undefined;
}

const STATE_GLYPH: Record<Exclude<ChangeState, 'clean'>, string> = {
  editing: '✎',
  saved: '☁',
  deleting: '✕',
};

const KIND_LABEL: Record<ChangeEntry['kind'], string> = {
  content: 'page',
  template: 'template',
  schema: 'schema',
  config: 'config',
  asset: 'asset',
};

interface ChangesPanelProps {
  entries: ChangeEntry[];
  client: RefTextClient;
  /** Published side (default branch) and changed side (WIP branch) for each row's diff. */
  baseRef: string;
  headRef: string;
  /** Bump to refetch diffs after a save advances the WIP tip. */
  bustKey?: string;
  onClose: () => void;
}

/**
 * The header "N changes" dropdown (SPEC §8/§11): a summary of every unpublished item
 * with its change state, each expandable to a raw diff (via {@link PathDiff}) against
 * the published version. Read-only overview + navigation — reverting lives on each
 * item's own Diff tab (content body editor / advanced panel). Assets show no diff
 * (binary), just their pending state.
 */
export function ChangesPanel({ entries, client, baseRef, headRef, bustKey, onClose }: ChangesPanelProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);

  // Dismiss like a normal dropdown: Escape, or a pointer down outside the panel (but not
  // on the summary button that toggles it — that path has its own toggle handler).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element | null;
      if (panelRef.current && !panelRef.current.contains(t) && !t?.closest?.('.changes--button')) {
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

  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="changes-panel" role="dialog" aria-label="Unpublished changes" ref={panelRef}>
      <header className="changes-panel__head">
        <span>
          Unpublished changes ({entries.length})
        </span>
        <button type="button" className="changes-panel__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      {entries.length === 0 ? (
        <p className="changes-panel__empty">Nothing pending — your branch matches the live site.</p>
      ) : (
        <ul className="changes-panel__list">
          {entries.map((entry) => {
            const expanded = open.has(entry.path);
            return (
              <li key={entry.path} className={`changes-panel__item changes-panel__item--${entry.state}`}>
                <div className="changes-panel__row">
                  <button
                    type="button"
                    className="changes-panel__toggle"
                    aria-expanded={expanded}
                    onClick={() => toggle(entry.path)}
                    title={expanded ? 'Hide diff' : 'Show diff'}
                  >
                    <span className={`changes-panel__glyph changes-panel__glyph--${entry.state}`} aria-hidden="true">
                      {STATE_GLYPH[entry.state]}
                    </span>
                    <span className="changes-panel__title">{entry.title}</span>
                    <span className="changes-panel__tag">{KIND_LABEL[entry.kind]}</span>
                    <span className="changes-panel__chevron" aria-hidden="true">
                      {expanded ? '▾' : '▸'}
                    </span>
                  </button>
                  {entry.onOpen ? (
                    <button
                      type="button"
                      className="changes-panel__open"
                      onClick={() => {
                        entry.onOpen?.();
                        onClose();
                      }}
                    >
                      Open
                    </button>
                  ) : null}
                </div>
                <code className="changes-panel__path">{entry.path}</code>
                {expanded ? (
                  <div className="changes-panel__diff">
                    {entry.kind === 'asset' ? (
                      <p className="diff-view diff-view--status">Binary asset — no text diff.</p>
                    ) : (
                      <PathDiff client={client} path={entry.path} baseRef={baseRef} headRef={headRef} bustKey={bustKey} />
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
