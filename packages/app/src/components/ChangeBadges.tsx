import type { SyncState } from '../state/autosave.js';
import type { ChangeState } from '../state/changes.js';
import { Spinner } from './Spinner.js';

/**
 * The change-lifecycle vocabulary, surfaced with a distinct **glyph + colour + text
 * label** (never colour alone, for colour-blind legibility). See SPEC §8/§11:
 *   Editing → Saved → (Submitted → Published, shown by the Publish button, not here).
 */
const CHANGE_META: Record<Exclude<ChangeState, 'clean'>, { glyph: string; label: string }> = {
  editing: { glyph: '✎', label: 'Editing — unsaved changes on this device' },
  saved: { glyph: '☁', label: 'Saved to your branch — not yet published' },
  deleting: { glyph: '✕', label: 'Deleting — will be removed when you publish (restorable until then)' },
};

/** Per-item lifecycle badge for the sidebar; nothing to show for a clean item. */
export function ChangeBadge({ state }: { state: ChangeState }): React.JSX.Element | null {
  if (state === 'clean') return null;
  const meta = CHANGE_META[state];
  return (
    <span className={`cbadge cbadge--${state}`} role="img" aria-label={meta.label} title={meta.label}>
      {meta.glyph}
    </span>
  );
}

/**
 * Storage-axis badge for an object kept **On this device** (SPEC §5/§8): held out of
 * the WIP commit, so its only copy is this browser's IndexedDB — private, but not
 * backed up. Distinct glyph + label (never colour alone), and it replaces the change
 * lifecycle badge in the sidebar since a device-only object isn't on the host at all.
 */
export function DeviceBadge(): React.JSX.Element {
  const label = 'On this device — not backed up (kept in this browser only)';
  return (
    <span className="cbadge cbadge--device" role="img" aria-label={label} title={label}>
      💻
    </span>
  );
}

/**
 * Page-visibility badge (Draft vs Public) — the axis orthogonal to the change
 * lifecycle. A Draft page's data still rides to `main`, but the build skips it, so it
 * never appears on the public site.
 */
export function VisibilityBadge({ isPublic }: { isPublic: boolean }): React.JSX.Element {
  const meta = isPublic
    ? { glyph: '●', label: 'Public — appears on the live site', cls: 'public' }
    : { glyph: '○', label: 'Draft — hidden from the live site', cls: 'draft' };
  return (
    <span className={`vbadge vbadge--${meta.cls}`} role="img" aria-label={meta.label} title={meta.label}>
      {meta.glyph}
    </span>
  );
}

interface ChangesSummaryProps {
  editing: number;
  saved: number;
  deleting: number;
  /** Objects kept On this device (SPEC §5/§8) — not backed up, not counted as pending publish. */
  device: number;
  syncState: SyncState;
  onSaveNow: () => void;
  /** Toggle the changes panel (the counts become a button when there's anything to show). */
  onToggle?: (() => void) | undefined;
  /** Whether the changes panel is currently open (drives aria-expanded + the caret). */
  expanded?: boolean | undefined;
}

/**
 * The header's aggregate change indicator. Normally shows the counts
 * ("✎ Editing 1 · ☁ Saved 4"); while a coalesced commit is in flight it becomes the
 * live save-status (Saving… / Save failed — retrying), absorbing the old standalone
 * sync indicator so there's one thing in this slot, not two. When `onToggle` is given
 * and there are changes, the counts are a button that opens the changes panel.
 */
export function ChangesSummary({
  editing,
  saved,
  deleting,
  device,
  syncState,
  onSaveNow,
  onToggle,
  expanded,
}: ChangesSummaryProps): React.JSX.Element {
  if (syncState === 'saving') {
    return (
      <div className="changes changes--saving">
        <span className="changes__dot" aria-hidden="true" /> Saving…
      </div>
    );
  }
  if (syncState === 'error') {
    return (
      <div className="changes changes--error">
        <span className="changes__dot" aria-hidden="true" /> Save failed — retrying
        <button type="button" className="changes__save" onClick={onSaveNow}>
          Save now
        </button>
      </div>
    );
  }
  const segments: React.JSX.Element[] = [];
  if (editing > 0)
    segments.push(
      <span key="editing" className="changes__seg changes__seg--editing">
        <span aria-hidden="true">✎</span> Editing {editing}
      </span>,
    );
  if (saved > 0)
    segments.push(
      <span key="saved" className="changes__seg changes__seg--saved">
        <span aria-hidden="true">☁</span> Saved {saved}
      </span>,
    );
  if (deleting > 0)
    segments.push(
      <span key="deleting" className="changes__seg changes__seg--deleting">
        <span aria-hidden="true">✕</span> Deleting {deleting}
      </span>,
    );
  if (device > 0)
    segments.push(
      <span key="device" className="changes__seg changes__seg--device">
        <span aria-hidden="true">💻</span> On device {device}
      </span>,
    );
  if (segments.length === 0) return <div className="changes changes--clean">No unpublished changes</div>;

  const inner = segments.flatMap((seg, i) =>
    i === 0 ? [seg] : [<span key={`sep${i}`} className="changes__sep"> · </span>, seg],
  );
  const label = `${editing} editing, ${saved} saved, ${deleting} deleting, ${device} on device`;

  // The changes panel lists publishable (branch) changes; device-only items aren't in it,
  // so when nothing is publishable the summary is plain text (no panel to open).
  const publishable = editing > 0 || saved > 0 || deleting > 0;
  if (onToggle && publishable) {
    return (
      <button
        type="button"
        className={`changes changes--button${expanded ? ' is-open' : ''}`}
        aria-label={`${label}. Show changed items.`}
        aria-expanded={expanded ?? false}
        onClick={onToggle}
      >
        {inner}
        <span className="changes__caret" aria-hidden="true">
          ▾
        </span>
      </button>
    );
  }

  return (
    <div className="changes" aria-label={label}>
      {inner}
    </div>
  );
}

/** The Publish action's states, from click through the site build to done/failed. */
export type PublishPhase = 'idle' | 'publishing' | 'building' | 'done' | 'failed';

const PUBLISH_LABEL: Record<PublishPhase, string> = {
  idle: 'Publish',
  publishing: 'Publishing…',
  building: 'Building…',
  done: 'Published ✓',
  // Reached only from 'building' — the merge to main already landed and it was the Pages
  // deploy that failed; retry re-runs the deploy, so name it for what actually broke.
  failed: 'Deploy failed — retry',
};

interface PublishButtonProps {
  phase: PublishPhase;
  /** Whether there's anything to publish (unsaved or saved-but-unpublished). */
  hasChanges: boolean;
  onPublish: () => void;
}

/**
 * The single **Publish** control that morphs into a status indicator as the change
 * travels to the live site: Publish → Publishing… → Building… → Published ✓ (or
 * Publish failed — retry). There's no standing "published" banner — the site is
 * always published; only what's *pending* is worth showing (SPEC §11).
 */
export function PublishButton({ phase, hasChanges, onPublish }: PublishButtonProps): React.JSX.Element {
  const busy = phase === 'publishing' || phase === 'building';
  const disabled = busy || (phase === 'idle' && !hasChanges);
  return (
    <button
      type="button"
      className={`publish-btn publish-btn--${phase}`}
      disabled={disabled}
      aria-busy={busy}
      onClick={onPublish}
    >
      {busy ? <Spinner /> : null}
      {PUBLISH_LABEL[phase]}
    </button>
  );
}
