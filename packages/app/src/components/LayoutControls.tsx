import type { PreviewMode, PreviewTab } from '../state/layout.js';

const MODE_LABEL: Record<PreviewMode, string> = {
  split: 'Split',
  tab: 'Tabs',
  off: 'Hide',
};

interface PreviewControlsProps {
  /** The user's chosen mode (may differ from what's shown on a narrow viewport). */
  mode: PreviewMode;
  /** The mode actually in effect (mobile downgrades 'split' → 'tab'). */
  effectiveMode: PreviewMode;
  tab: PreviewTab;
  isMobile: boolean;
  popOutOpen: boolean;
  /** Pop-out is content-only (advanced has its own iframe preview). */
  showPopOut: boolean;
  onMode: (mode: PreviewMode) => void;
  onTab: (tab: PreviewTab) => void;
  onPopOut: () => void;
}

/**
 * Banner controls for the preview: an Edit⇄Preview switch (only meaningful in tab
 * mode), a Split / Tabs / Hide segmented control, and a pop-out button. Side-by-side
 * split is dropped from the choices on mobile, where it isn't workable (SPEC §8).
 */
export function PreviewControls({
  mode,
  effectiveMode,
  tab,
  isMobile,
  popOutOpen,
  showPopOut,
  onMode,
  onTab,
  onPopOut,
}: PreviewControlsProps): React.JSX.Element {
  const modes: PreviewMode[] = isMobile ? ['tab', 'off'] : ['split', 'tab', 'off'];
  return (
    <div className="preview-controls">
      {effectiveMode === 'tab' ? (
        <div className="tab-switch" role="tablist" aria-label="Edit or preview">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'edit'}
            className={tab === 'edit' ? 'is-active' : ''}
            onClick={() => onTab('edit')}
          >
            Edit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'preview'}
            className={tab === 'preview' ? 'is-active' : ''}
            onClick={() => onTab('preview')}
          >
            Preview
          </button>
        </div>
      ) : null}
      <div className="seg" role="group" aria-label="Preview layout">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? 'is-active' : ''}
            aria-pressed={mode === m}
            onClick={() => onMode(m)}
            title={`Preview: ${MODE_LABEL[m]}`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {showPopOut ? (
        <button
          type="button"
          className={`preview-controls__popout${popOutOpen ? ' is-active' : ''}`}
          onClick={onPopOut}
          aria-pressed={popOutOpen}
          title={popOutOpen ? 'Close the preview window' : 'Open preview in a new window'}
          aria-label={
            popOutOpen ? 'Close the preview window' : 'Open preview in a new window'
          }
        >
          ↗
        </button>
      ) : null}
    </div>
  );
}
