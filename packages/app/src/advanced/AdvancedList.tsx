import { useMemo } from 'react';
import type { AdvancedFile } from './loadAdvancedFiles.js';
import { ChangeBadge } from '../components/ChangeBadges.js';
import type { ChangeState } from '../state/changes.js';
import { advancedFileName, groupAdvancedFiles } from './advancedList.js';

interface AdvancedListProps {
  files: AdvancedFile[];
  selectedPath: string | undefined;
  /** Paths with local-only edits (uncommitted) — badged Editing, as content rows are. */
  editingPaths?: ReadonlySet<string>;
  /** Paths committed to the WIP branch but not yet published — badged Saved. */
  savedPaths?: ReadonlySet<string>;
  onSelect: (path: string) => void;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The advanced navigator: templates + config grouped by kind (Templates, Schemas,
 * Config), mirroring the content list's grouped shape (SPEC §8). Each file shows its
 * basename with the full repo path as the secondary line, and — like a content row —
 * its change-lifecycle badge, so an edit here reads as pending at a glance instead of
 * looking identical to a published file until the next commit lands.
 */
export function AdvancedList({
  files,
  selectedPath,
  editingPaths = EMPTY,
  savedPaths = EMPTY,
  onSelect,
}: AdvancedListProps): React.JSX.Element {
  const groups = useMemo(() => groupAdvancedFiles(files), [files]);

  const changeStateOf = (path: string): ChangeState =>
    editingPaths.has(path) ? 'editing' : savedPaths.has(path) ? 'saved' : 'clean';

  if (groups.length === 0) {
    return <p className="object-list__empty">No files.</p>;
  }

  return (
    <>
      {groups.map((group) => (
        <section className="object-group" key={group.kind}>
          <div className="object-group__head">
            <span className="object-group__name">
              {group.label}
              <span className="object-group__count">{group.files.length}</span>
            </span>
          </div>

          <ul className="object-list">
            {group.files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  className={f.path === selectedPath ? 'is-active' : ''}
                  onClick={() => onSelect(f.path)}
                >
                  <span className="object-list__title">
                    <ChangeBadge state={changeStateOf(f.path)} />
                    {advancedFileName(f)}
                  </span>
                  <span className="object-list__type">{f.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
