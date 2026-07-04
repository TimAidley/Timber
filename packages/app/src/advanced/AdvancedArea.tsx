import { useEffect, useMemo, useRef, useState } from 'react';
import { renderPage, type FrontMatter } from '@timber/generator';
import { siteContext, pageSeo, type ContentObject, type SiteContext, type PageSeo } from '@timber/content';
import type { RepoSession } from '../state/repoSession.js';
import type { Autosave } from '../state/autosave.js';
import { LocalDraftStore } from '../state/localDraft.js';
import { reassembleDocument } from '../content/document.js';
import { repoConfig } from '../github/config.js';
import { CodeEditor } from './CodeEditor.js';
import { loadAdvancedFiles, type AdvancedFile } from './loadAdvancedFiles.js';
import { validateAdvancedFile, type AdvancedValidation } from './validate.js';

/** Build the `{ markdown, site, seo }` context for previewing a template against a
 * real content object — the same derivation the CLI build uses, so the preview
 * reflects production. Returns null if the repo has no renderable page object. */
function sampleRender(
  session: RepoSession,
): { markdown: string; site: SiteContext; seo: PageSeo } | null {
  const { model } = session;
  const settings = model.objects.find((o) => model.schemas.get(o.type)?.page === false);
  const site = siteContext(settings);
  const sample: ContentObject | undefined = model.objects.find(
    (o) => model.schemas.get(o.type)?.page !== false,
  );
  if (!sample) return null;
  const schema = model.schemas.get(sample.type);
  if (!schema) return null;
  return {
    markdown: reassembleDocument(sample.data as FrontMatter, sample.body),
    site,
    seo: pageSeo(sample, schema, site),
  };
}

/**
 * The advanced/admin area (SPEC §8): the same edit-preview-commit loop pointed at
 * `templates/*.liquid` and `config/**` — the files the content editor never touches.
 * These live outside the content snapshot, so they're loaded here via
 * {@link loadAdvancedFiles}. Every edit is validated with the *same* machinery the
 * build uses; per the locked decision an **invalid** file is never committed (a broken
 * template must not reach the build) but its draft is kept in IndexedDB so nothing is
 * lost. Valid edits flow through the shared {@link Autosave} into the one coalesced
 * WIP commit.
 */
export function AdvancedArea({
  session,
  autosave,
}: {
  session: RepoSession;
  autosave: Autosave;
}): React.JSX.Element {
  const [files, setFiles] = useState<AdvancedFile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>('');
  // The working text per file (draft/dirty/committed), keyed by path.
  const [text, setText] = useState<Map<string, string>>(new Map());

  const repoKey = `${repoConfig.owner}/${repoConfig.repo}`;
  const draftStore = useRef<LocalDraftStore | null>(null);

  // Load the editable files, then reconcile any locally-saved drafts on top (a draft
  // may be a not-yet-committed fix to a previously-invalid file).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const store = await LocalDraftStore.open();
        const loaded = await loadAdvancedFiles(session.client, session.loadedRef);
        if (cancelled) return;
        draftStore.current = store;
        const working = new Map(loaded.map((f) => [f.path, f.content]));
        for (const draft of await store.allForRepo(repoKey)) {
          if (working.has(draft.path) && draft.body !== working.get(draft.path)) {
            working.set(draft.path, draft.body);
            // A restored draft may be an as-yet-uncommitted valid edit; re-queue it.
            const file = loaded.find((f) => f.path === draft.path)!;
            if (validateAdvancedFile({ ...file, content: draft.body }).valid) {
              autosave.markFileDirty(draft.path, draft.body);
            }
          }
        }
        if (cancelled) return;
        setFiles(loaded);
        setText(working);
        setSelectedPath((prev) => prev || loaded[0]?.path || '');
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Load once per session; reconciliation is a load-time step. `repoKey`/`autosave`
    // are stable for the session, so `session` is the only meaningful dependency.
  }, [session]);

  const selected = files?.find((f) => f.path === selectedPath);
  const value = selected ? text.get(selected.path) ?? selected.content : '';

  const validation: AdvancedValidation | undefined = useMemo(
    () => (selected ? validateAdvancedFile({ ...selected, content: value }) : undefined),
    [selected, value],
  );

  function onEdit(next: string): void {
    if (!selected) return;
    setText((prev) => new Map(prev).set(selected.path, next));
    // Always keep a local draft (nothing is lost); only commit valid files.
    void draftStore.current?.put(repoKey, selected.path, {}, next);
    if (validateAdvancedFile({ ...selected, content: next }).valid) {
      autosave.markFileDirty(selected.path, next);
    }
  }

  if (loadError) {
    return <div className="advanced advanced--error">Couldn’t load advanced files: {loadError}</div>;
  }
  if (!files) {
    return <div className="advanced advanced--loading">Loading templates &amp; config…</div>;
  }

  return (
    <div className="advanced">
      <nav className="advanced__files">
        <h3>Templates &amp; config</h3>
        <ul>
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                className={f.path === selectedPath ? 'is-active' : ''}
                onClick={() => setSelectedPath(f.path)}
              >
                <span className="advanced__path">{f.path}</span>
                <span className="advanced__kind">{f.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section className="advanced__editor">
        {selected ? (
          <>
            <header className="advanced__header">
              <code>{selected.path}</code>
            </header>
            <CodeEditor value={value} kind={selected.kind} onChange={onEdit} />
            {validation && !validation.valid ? (
              <div className="advanced__validation advanced__validation--bad" role="alert">
                <strong>Not saved to your branch — fix before it can be committed:</strong>
                <ul>
                  {validation.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                <p className="advanced__hint">Your draft is kept locally so nothing is lost.</p>
              </div>
            ) : (
              <div className="advanced__validation advanced__validation--ok">✓ Valid — saved to your branch</div>
            )}
          </>
        ) : (
          <p>No editable file selected.</p>
        )}
      </section>

      <aside className="advanced__preview">
        <h3>Preview</h3>
        {selected?.kind === 'template' ? (
          <TemplatePreview session={session} template={value} valid={validation?.valid ?? false} />
        ) : (
          <p className="advanced__preview-empty">Preview shows for templates. Config is validated on edit.</p>
        )}
      </aside>
    </div>
  );
}

/** Render a sample content object through the *edited* template — the live half of
 * the advanced edit-preview loop. Only renders when the template parses (an invalid
 * template would throw); otherwise the validation banner already explains the block. */
function TemplatePreview({
  session,
  template,
  valid,
}: {
  session: RepoSession;
  template: string;
  valid: boolean;
}): React.JSX.Element {
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ctx = useMemo(() => sampleRender(session), [session]);

  useEffect(() => {
    if (!valid || !ctx) return;
    let cancelled = false;
    renderPage({ markdown: ctx.markdown, template, site: ctx.site, seo: ctx.seo })
      .then((out) => {
        if (!cancelled) {
          setHtml(out);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [template, valid, ctx]);

  if (!ctx) return <p className="advanced__preview-empty">No content object to preview against.</p>;
  if (!valid) return <p className="advanced__preview-empty">Fix the template to see the preview.</p>;
  if (error) return <pre className="preview preview--error">{error}</pre>;
  return <iframe className="advanced__frame" title="Template preview" srcDoc={html} />;
}
