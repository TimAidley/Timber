import { useEffect, useMemo, useRef, useState } from 'react';
import { canPublish, Validator, type ContentObject } from '@timber/content';
import type { FrontMatter } from '@timber/generator';
import type { RepoSession } from './state/repoSession.js';
import { AssetStore } from './state/assets.js';
import { useAutosave } from './state/autosave.js';
import { LocalDraftStore } from './state/localDraft.js';
import { reassembleDocument } from './content/document.js';
import { repoConfig } from './github/config.js';
import { SchemaForm } from './forms/SchemaForm.js';
import { BodyEditor } from './editor/BodyEditor.js';
import { Preview } from './preview/Preview.js';
import { SyncIndicator } from './components/SyncIndicator.js';
import { PublishDialog } from './components/PublishDialog.js';
import { DeployStatus } from './components/DeployStatus.js';
import { AdvancedArea } from './advanced/AdvancedArea.js';
import { canAccessAdvanced } from './github/access.js';

/** The deploy workflow's file name (the starter template ships deploy.yml). */
const DEPLOY_WORKFLOW = 'deploy.yml';

interface EditState {
  data: FrontMatter;
  body: string;
}

/**
 * The editing surface, driven by a loaded {@link RepoSession} (real repo content),
 * not the bundled demo. Pick an object, edit its front matter (schema form) and
 * body (Milkdown), see live preview + validation. Persistence to the WIP branch is
 * layered on in Slice 5a's autosave step; here edits live in memory.
 */
export function Editor({ session }: { session: RepoSession }): React.JSX.Element {
  const { model } = session;
  const validator = useMemo(() => new Validator(model.schemas), [model]);
  const assetStore = useMemo(() => new AssetStore(), []);
  const autosave = useAutosave(session, assetStore);

  // Content editing vs. the advanced/admin area (templates + config), gated by the
  // canAccessAdvanced() seam (SPEC §8/§10). Both share this one session + autosave, so
  // switching never drops unsaved state and edits coalesce into the same WIP commit.
  const advancedAllowed = canAccessAdvanced();
  const [view, setView] = useState<'content' | 'advanced'>('content');

  // Publish dialog + the conflict base SHA, which advances each time we publish.
  const [showPublish, setShowPublish] = useState(false);
  const [baseSha, setBaseSha] = useState(session.baseSha);
  // Bumped after a publish so the deploy-status indicator re-checks the new run.
  const [deployPollKey, setDeployPollKey] = useState(0);

  const [selectedPath, setSelectedPath] = useState<string>(model.objects[0]?.path ?? '');
  const selected: ContentObject | undefined = model.objects.find((o) => o.path === selectedPath);

  const [edit, setEdit] = useState<EditState>(() => {
    const first = model.objects[0];
    return { data: { ...(first?.data ?? {}) }, body: first?.body ?? '' };
  });
  const [editingPath, setEditingPath] = useState(selectedPath);
  // On selection change, restore an in-progress edit (autosave) if present, so
  // switching objects never loses unsaved work; else seed from the model.
  if (selected && editingPath !== selectedPath) {
    setEditingPath(selectedPath);
    const dirty = autosave.getDirtyObject(selectedPath);
    setEdit(dirty ? { data: { ...dirty.data }, body: dirty.body } : { data: { ...selected.data }, body: selected.body });
  }

  const schema = selected ? model.schemas.get(selected.type) : undefined;

  // Device-local draft persistence (SPEC §11): recover unsaved edits after a
  // reload/crash before the WIP commit landed.
  const repoKey = `${repoConfig.owner}/${repoConfig.repo}`;
  const draftStore = useRef<LocalDraftStore | null>(null);
  useEffect(() => {
    let cancelled = false;
    void LocalDraftStore.open()
      .then(async (store) => {
        if (cancelled) return;
        draftStore.current = store;
        for (const draft of await store.allForRepo(repoKey)) {
          const committed = model.objects.find((o) => o.path === draft.path);
          if (!committed) continue;
          const changed =
            reassembleDocument(draft.data, draft.body) !==
            reassembleDocument(committed.data, committed.body);
          if (changed) {
            // Restore as an unsaved edit; autosave will re-commit it to WIP.
            autosave.markObjectDirty(draft.path, draft.data, draft.body);
            if (draft.path === selectedPath) setEdit({ data: { ...draft.data }, body: draft.body });
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Run once on mount; recovery is a load-time step.
  }, []);

  // Every edit updates local state, marks the object dirty (debounced commit), and
  // persists a local draft for crash recovery.
  function applyEdit(next: EditState): void {
    setEdit(next);
    autosave.markObjectDirty(selectedPath, next.data, next.body);
    void draftStore.current?.put(repoKey, selectedPath, next.data, next.body);
  }

  function updateField(key: string, value: unknown): void {
    const data = { ...edit.data };
    if (value === undefined || value === '') delete data[key];
    else data[key] = value;
    applyEdit({ ...edit, data });
  }

  const validation = useMemo(() => {
    if (!selected || !schema) return undefined;
    const candidate: ContentObject = {
      ...selected,
      data: edit.data,
      body: edit.body,
      public: edit.data.public === true,
    };
    return validator.validateObject(candidate, model);
  }, [selected, schema, edit, validator, model]);

  return (
    <div className="app">
      <aside className="app__sidebar">
        <h1 className="app__brand">Timber</h1>
        <p className="app__repo">
          <code>{session.loadedRef}</code>
        </p>
        <SyncIndicator state={autosave.syncState} onSaveNow={autosave.saveNow} />
        <DeployStatus
          client={session.client}
          workflowFile={DEPLOY_WORKFLOW}
          branch={session.defaultBranch}
          pollKey={deployPollKey}
        />
        <button type="button" className="publish-btn" onClick={() => setShowPublish(true)}>
          Publish…
        </button>
        {advancedAllowed ? (
          <div className="view-toggle" role="tablist" aria-label="Editor view">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'content'}
              className={view === 'content' ? 'is-active' : ''}
              onClick={() => setView('content')}
            >
              Content
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'advanced'}
              className={view === 'advanced' ? 'is-active' : ''}
              onClick={() => setView('advanced')}
            >
              Advanced
            </button>
          </div>
        ) : null}
        <nav>
          <ul className="object-list">
            {model.objects.map((o) => (
              <li key={o.path}>
                <button
                  type="button"
                  className={o.path === selectedPath ? 'is-active' : ''}
                  onClick={() => setSelectedPath(o.path)}
                >
                  <span className="object-list__title">{String(o.data.title ?? o.slug)}</span>
                  <span className="object-list__type">
                    {o.type}
                    {o.public ? '' : ' · draft'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {view === 'advanced' ? (
        <AdvancedArea session={session} autosave={autosave} />
      ) : (
        <>
      <main className="app__main">
        {selected && schema ? (
          <>
            <header className="editor-header">
              <h2>{String(edit.data.title ?? selected.slug)}</h2>
              <code>{selected.path}</code>
            </header>

            <section className="editor-panel">
              <h3>Fields</h3>
              <SchemaForm
                schema={schema}
                data={edit.data}
                model={model}
                assetStore={assetStore}
                bundleDir={selected.path.replace(/\/index\.md$/, '')}
                onAssetStaged={autosave.markAssetDirty}
                onChange={updateField}
              />
            </section>

            <section className="editor-panel">
              <h3>Body</h3>
              <BodyEditor value={edit.body} onChange={(body) => applyEdit({ ...edit, body })} />
            </section>

            {validation ? (
              <section className={`validation ${validation.valid ? 'validation--ok' : 'validation--bad'}`}>
                <strong>
                  {validation.valid ? '✓ Valid' : '✗ Invalid'} —{' '}
                  {canPublish(validation) ? 'can be published' : 'draft only'}
                </strong>
                {validation.errors.length > 0 ? (
                  <ul>
                    {validation.errors.map((e, i) => (
                      <li key={i}>
                        {e.field ? <code>{e.field}</code> : null} {e.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </>
        ) : (
          <p>No object selected.</p>
        )}
      </main>

      <aside className="app__preview">
        <h3>Preview</h3>
        {selected ? <Preview data={edit.data} body={edit.body} assetStore={assetStore} /> : null}
      </aside>
        </>
      )}

      {showPublish ? (
        <PublishDialog
          client={session.client}
          ctx={{ wipBranch: session.wipBranch, defaultBranch: session.defaultBranch, baseSha }}
          onClose={() => setShowPublish(false)}
          onPublished={(sha) => {
            setBaseSha(sha);
            setDeployPollKey((k) => k + 1); // deploy kicks off on the push to main
          }}
        />
      ) : null}
    </div>
  );
}
