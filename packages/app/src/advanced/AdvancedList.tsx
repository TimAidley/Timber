import { useMemo } from 'react';
import type { AdvancedFile } from './loadAdvancedFiles.js';
import { advancedFileName, groupAdvancedFiles } from './advancedList.js';

interface AdvancedListProps {
  files: AdvancedFile[];
  selectedPath: string | undefined;
  onSelect: (path: string) => void;
}

/**
 * The advanced navigator: templates + config grouped by kind (Templates, Schemas,
 * Config), mirroring the content list's grouped shape (SPEC §8). Each file shows its
 * basename with the full repo path as the secondary line.
 */
export function AdvancedList({
  files,
  selectedPath,
  onSelect,
}: AdvancedListProps): React.JSX.Element {
  const groups = useMemo(() => groupAdvancedFiles(files), [files]);

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
                  <span className="object-list__title">{advancedFileName(f)}</span>
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
