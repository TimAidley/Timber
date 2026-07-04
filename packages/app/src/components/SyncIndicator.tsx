import type { SyncState } from '../state/autosave.js';

const LABELS: Record<SyncState, string> = {
  idle: 'All changes saved to your branch',
  dirty: 'Unsaved local changes',
  saving: 'Saving…',
  saved: 'All changes saved to your branch',
  error: 'Save failed — retrying',
};

/**
 * The sync-state indicator (SPEC §8): "load-bearing for making the local-vs-branch
 * model legible." Surfaces whether the WIP branch is up to date with local edits.
 */
export function SyncIndicator({ state, onSaveNow }: { state: SyncState; onSaveNow: () => void }): React.JSX.Element {
  return (
    <div className={`sync sync--${state}`}>
      <span className="sync__dot" aria-hidden="true" />
      <span className="sync__label">{LABELS[state]}</span>
      {state === 'dirty' || state === 'error' ? (
        <button type="button" className="sync__save" onClick={onSaveNow}>
          Save now
        </button>
      ) : null}
    </div>
  );
}
