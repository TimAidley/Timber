import { useState } from 'react';
import type { ThemeImportPlan } from '@timber/jekyll-compat';
import type { RepoSession } from '../state/repoSession.js';
import { importThemeFromZip } from '../theme/importTheme.js';

interface ImportThemeDialogProps {
  session: RepoSession;
  onClose: () => void;
}

/** Reload the editor so the imported theme's templates + assets are picked up. */
function reloadEditor(): void {
  window.location.reload();
}

/**
 * "Import Jekyll theme" dialog (SPEC §2 → Tier A) — the browser side of adopt-once. Upload a
 * theme `.zip` (e.g. GitHub's "Download ZIP"); it's transformed to native `templates/*.liquid`
 * + assets (SCSS source carried over, compiled by @timber/sass at build/preview time) and
 * committed to your WIP branch in one commit. No terminal. After import, reload to pick it up.
 */
export function ImportThemeDialog({
  session,
  onClose,
}: ImportThemeDialogProps): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ThemeImportPlan | null>(null);

  async function submit(): Promise<void> {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const plan = await importThemeFromZip(session, bytes);
      setDone(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-label="Import Jekyll theme">
      <div className="modal__panel">
        <header className="modal__header">
          <h2>Import Jekyll theme</h2>
        </header>

        {done ? (
          <>
            <p>
              Imported <strong>{Object.keys(done.templates).length}</strong> template(s)
              (root layout <code>{done.rootLayout}</code>, default{' '}
              <code>{done.defaultLayout}</code>). Committed to your working branch.
            </p>
            <p className="new-type__hint">
              Reload the editor to pick up the theme. Every content type renders through{' '}
              <code>templates/default.liquid</code> until you add a{' '}
              <code>templates/&lt;type&gt;.liquid</code>.
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
              Upload a Jekyll theme <code>.zip</code> (e.g. a repo’s “Download ZIP”). Its{' '}
              <code>_layouts</code>/<code>_includes</code> become native templates and its
              assets (incl. SCSS) are carried over — then committed to your working
              branch.
            </p>
            <label className="new-type__group">
              <span>Theme .zip</span>
              <input
                type="file"
                accept=".zip,application/zip"
                disabled={busy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError(null);
                }}
              />
            </label>
            {error ? <p className="new-type__error">{error}</p> : null}
            <div className="modal__actions">
              <button type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={!file || busy}
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
