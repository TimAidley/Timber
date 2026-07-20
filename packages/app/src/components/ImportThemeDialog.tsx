import { useState } from 'react';
import type { ThemeImportPlan } from '@timber/jekyll-compat';
import type { RepoSession } from '../state/repoSession.js';
import {
  importThemeFromZip,
  defaultThemeNameFromZip,
  slugifyThemeName,
} from '../theme/importTheme.js';

interface ImportThemeDialogProps {
  session: RepoSession;
  /**
   * The settings singleton to activate the imported theme in (its `index.md` path + current
   * content). When present, the import flips `activeTheme` to the new folder in the same commit
   * so it goes live. Absent (no settings singleton) → the user sets `activeTheme` by hand.
   */
  settingsFile?: { path: string; source: string };
  onClose: () => void;
}

/** Reload the editor so the imported theme's templates + assets are picked up. */
function reloadEditor(): void {
  window.location.reload();
}

/**
 * "Import Jekyll theme" dialog (SPEC §2 → Tier A, §13 themes) — the browser side of adopt-once.
 * Upload a theme `.zip` (e.g. GitHub's "Download ZIP"); it's transformed to native templates +
 * assets under a self-contained `themes/<name>/` folder (SCSS source carried over, compiled by
 * @timber/sass at build/preview time) and committed to your WIP branch in one commit, with the
 * site's `activeTheme` pointed at it. Any previous theme stays on disk, so switching back is one
 * setting. No terminal. After import, reload to pick it up.
 */
export function ImportThemeDialog({
  session,
  settingsFile,
  onClose,
}: ImportThemeDialogProps): React.JSX.Element {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [name, setName] = useState('');
  const [engineName, setEngineName] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ThemeImportPlan | null>(null);

  async function onFile(file: File | null): Promise<void> {
    setError(null);
    if (!file) {
      setBytes(null);
      return;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    setBytes(buf);
    // Default the folder name to the archive's wrapper dir (e.g. minima-3.0.0 → minima-3-0-0);
    // the user can rename before importing.
    if (!name) setName(defaultThemeNameFromZip(buf));
  }

  async function submit(): Promise<void> {
    const themeName = slugifyThemeName(name);
    if (!bytes || busy || !themeName) return;
    setBusy(true);
    setError(null);
    try {
      const plan = await importThemeFromZip(session, bytes, {
        themeName,
        engineName,
        ...(settingsFile ? { activate: settingsFile } : {}),
      });
      setDone(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-label="Import theme">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>Import theme</h2>
        </header>

        {done ? (
          <>
            <p>
              Imported <strong>{Object.keys(done.templates).length}</strong>{' '}
              <strong>{done.engine ?? 'jekyll'}</strong> template(s) into{' '}
              <code>themes/{done.themeName}/</code> (root layout{' '}
              <code>{done.rootLayout}</code>, default <code>{done.defaultLayout}</code>).
              {settingsFile ? ' It’s now your active theme.' : ''} Committed to your working
              branch.
            </p>
            <p className="new-type__hint">
              Reload the editor to pick up the theme. Every content type renders through{' '}
              <code>themes/{done.themeName}/templates/default.liquid</code> until you add a{' '}
              <code>&lt;type&gt;.liquid</code>. Your previous theme stays under its own{' '}
              <code>themes/</code> folder — switch back any time from Settings.
            </p>
            <div className="modal__actions">
              <button type="button" onClick={onClose}>
                Close
              </button>
              <button type="button" className="is-primary" onClick={reloadEditor}>
                Reload editor
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="new-type__hint">
              Upload a <strong>Jekyll</strong> or <strong>Liquid Eleventy</strong> theme{' '}
              <code>.zip</code> (e.g. a repo’s “Download ZIP”). Its templates become native
              Timber templates and its assets (incl. SCSS) are carried over into a{' '}
              <code>themes/&lt;name&gt;/</code> folder — then committed to your working branch
              {settingsFile ? ' and set as the active theme' : ''}.
            </p>
            <label className="new-type__group">
              <span>Theme .zip</span>
              <input
                type="file"
                accept=".zip,application/zip"
                disabled={busy}
                onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <label className="new-type__group">
              <span>Source engine</span>
              <select
                value={engineName}
                disabled={busy}
                onChange={(e) => setEngineName(e.target.value)}
              >
                <option value="auto">Auto-detect</option>
                <option value="jekyll">Jekyll</option>
                <option value="eleventy">Eleventy (Liquid)</option>
              </select>
            </label>
            <label className="new-type__group">
              <span>Theme name (folder)</span>
              <input
                type="text"
                value={name}
                placeholder="e.g. minima"
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
              <span className="new-type__hint">
                Stored at <code>themes/{slugifyThemeName(name) || '…'}/</code>.
              </span>
            </label>
            {error ? <p className="new-type__error">{error}</p> : null}
            <div className="modal__actions">
              <button type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={!bytes || !slugifyThemeName(name) || busy}
                onClick={() => void submit()}
              >
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
