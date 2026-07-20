import { useState } from 'react';
import { setFrontMatterScalar } from '@timber/jekyll-compat';
import type { TreeEntry } from '@timber/host';
import type { RepoSession } from '../state/repoSession.js';
import { listThemes, themeFolderPaths } from '../theme/themeFolders.js';

interface ThemeManagerProps {
  session: RepoSession;
  /** The currently active theme (settings.activeTheme), or undefined for the legacy root. */
  activeTheme?: string;
  /**
   * The settings singleton's file (path + current content). Switching writes `activeTheme`
   * into it; absent (no settings singleton) → switching is disabled.
   */
  settingsFile?: { path: string; source: string };
  /** The loaded repo tree, for discovering theme folders and their delete sets. */
  treeEntries: readonly TreeEntry[];
}

/**
 * Theme manager (SPEC §13): switch the active theme, or delete one. Each theme is a
 * self-contained `themes/<name>/` folder, so switching is one settings write and deleting is
 * removing a folder — you can try a theme, then switch back or bin it without touching the
 * others. The active theme can't be deleted (switch away first), so a site is never left
 * theme-less. Commits land on the working branch (like the rest of the editor); publish makes
 * them live. Importing more themes is under "↓ Import theme" in the file list.
 */
export function ThemeManager({
  session,
  activeTheme,
  settingsFile,
  treeEntries,
}: ThemeManagerProps): React.JSX.Element {
  const themes = listThemes(treeEntries);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function commit(message: string, input: Parameters<typeof run>[0]): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await run(input, message);
      setDone(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function run(
    input: { files?: { path: string; content: string }[]; deletions?: string[] },
    message: string,
  ): Promise<void> {
    await session.client.commitFiles({
      branch: session.wipBranch,
      baseBranch: session.defaultBranch,
      message,
      files: input.files ?? [],
      ...(input.deletions ? { deletions: input.deletions } : {}),
    });
  }

  function switchTo(name: string): void {
    if (!settingsFile || busy) return;
    void commit(`Switch active theme to "${name}"`, {
      files: [
        {
          path: settingsFile.path,
          content: setFrontMatterScalar(settingsFile.source, 'activeTheme', name),
        },
      ],
    });
  }

  function remove(name: string): void {
    if (busy) return;
    const paths = themeFolderPaths(treeEntries, name);
    setConfirmDelete(null);
    void commit(`Delete theme "${name}"`, { deletions: paths });
  }

  if (done) {
    return (
      <div className="theme-manager">
        <header className="editor-header">
          <div className="editor-header__title">
            <h2>Themes</h2>
          </div>
        </header>
        <p>{done}. Committed to your working branch.</p>
        <p className="new-type__hint">Reload the editor to see the change.</p>
        <div className="modal__actions">
          <button
            type="button"
            className="is-primary"
            onClick={() => window.location.reload()}
          >
            Reload editor
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="theme-manager">
      <header className="editor-header">
        <div className="editor-header__title">
          <h2>Themes</h2>
          <code>themes/</code>
        </div>
      </header>

      {error ? <p className="new-type__error">{error}</p> : null}

      {themes.length === 0 ? (
        <p className="object-list__empty">
          No themes yet. Import one with <strong>↓ Import theme</strong> in the file list.
        </p>
      ) : (
        <ul className="theme-manager__list">
          {themes.map((name) => {
            const isActive = name === activeTheme;
            return (
              <li key={name} className={isActive ? 'is-active' : ''}>
                <div className="theme-manager__row">
                  <span className="theme-manager__name">
                    <code>themes/{name}/</code>
                    {isActive ? <span className="theme-manager__badge">Active</span> : null}
                  </span>
                  <span className="theme-manager__actions">
                    {isActive ? (
                      <span className="theme-manager__hint">In use</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="is-primary"
                          disabled={busy || !settingsFile}
                          title={
                            settingsFile
                              ? undefined
                              : 'Add a settings singleton to switch themes'
                          }
                          onClick={() => switchTo(name)}
                        >
                          Use this theme
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmDelete(name)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {confirmDelete === name ? (
                  <div className="theme-manager__confirm">
                    <p>
                      Delete <code>themes/{name}/</code> and everything in it? Until you
                      publish it’s only on your working branch, so you can still discard it.
                    </p>
                    <div className="modal__actions">
                      <button type="button" onClick={() => setConfirmDelete(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        disabled={busy}
                        onClick={() => remove(name)}
                      >
                        Delete theme
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {activeTheme && !themes.includes(activeTheme) ? (
        <p className="new-type__hint">
          Active theme <code>{activeTheme}</code> has no <code>themes/{activeTheme}/</code>{' '}
          folder — the site falls back to the legacy root theme. Import it or pick another.
        </p>
      ) : null}
    </div>
  );
}
