import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canPublish, Validator, type ContentModel, type ContentObject, type ContentTypeSchema } from '@timber/content';
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
import {
  ChangeBadge,
  ChangesSummary,
  PublishButton,
  VisibilityBadge,
  type PublishPhase,
} from './components/ChangeBadges.js';
import { PublishDialog } from './components/PublishDialog.js';
import { objectChangeState, summarizeChanges } from './state/changes.js';
import { useDeployPoll } from './state/useDeployPoll.js';
import { NewObjectDialog } from './components/NewObjectDialog.js';
import { DeleteDialog } from './components/DeleteDialog.js';
import { RenameDialog } from './components/RenameDialog.js';
import { AdvancedArea } from './advanced/AdvancedArea.js';
import { canAccessAdvanced } from './github/access.js';
import { newObject } from './content/newObject.js';
import { useBackNavigationGuard } from './editor/backNavGuard.js';

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
  // Stop a stray Backspace / Back from navigating away and losing unsaved edits.
  useBackNavigationGuard();
  const validator = useMemo(() => new Validator(model.schemas), [model]);
  const assetStore = useMemo(() => new AssetStore(), []);
  const autosave = useAutosave(session, assetStore);

  // The working object list — mutated by create/delete/rename (SPEC §5). The derived
  // `workingModel` recomputes the id index so validation, reference pickers, and the
  // delete guard see these mutations live (a new object is immediately referenceable;
  // a deleted one immediately dangling).
  const [objects, setObjects] = useState<ContentObject[]>(model.objects);
  const workingModel: ContentModel = useMemo(
    () => ({
      ...model,
      objects,
      byId: new Map(objects.filter((o) => o.id).map((o) => [o.id as string, o] as const)),
    }),
    [model, objects],
  );
  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContentObject | null>(null);
  const [showRename, setShowRename] = useState(false);

  // Content editing vs. the advanced/admin area (templates + config), gated by the
  // canAccessAdvanced() seam (SPEC §8/§10). Both share this one session + autosave, so
  // switching never drops unsaved state and edits coalesce into the same WIP commit.
  const advancedAllowed = canAccessAdvanced();
  const [view, setView] = useState<'content' | 'advanced'>('content');

  // Publish dialog + the conflict base SHA, which advances each time we publish.
  const [showPublish, setShowPublish] = useState(false);
  const [baseSha, setBaseSha] = useState(session.baseSha);

  // The Publish button's morph state (idle → publishing → building → done/failed) and,
  // for the deploy poll, the created-time of the newest run seen *before* we publish —
  // so a stale completed run can't be mistaken for our new one.
  const [publishPhase, setPublishPhase] = useState<PublishPhase>('idle');
  const [deploySince, setDeploySince] = useState<string | undefined>(undefined);
  const deployState = useDeployPoll(
    session.client,
    DEPLOY_WORKFLOW,
    session.defaultBranch,
    publishPhase === 'building',
    deploySince,
  );

  // Objects committed to WIP but not yet on main ("Saved"). Refreshed on load and
  // after each successful autosave/publish. `editingPaths` (local-only) comes from the
  // autosaver; an object that's both counts as Editing (the furthest-back state).
  const [savedPaths, setSavedPaths] = useState<ReadonlySet<string>>(new Set());
  const refreshSaved = useCallback(async () => {
    try {
      const changed = await session.client.compareChangedPaths(session.defaultBranch, session.wipBranch);
      setSavedPaths(new Set(changed.map((c) => c.path)));
    } catch {
      // WIP branch may not exist yet (nothing saved) — nothing published-pending.
      setSavedPaths(new Set());
    }
  }, [session]);
  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);
  useEffect(() => {
    if (autosave.syncState === 'saved') void refreshSaved();
  }, [autosave.syncState, refreshSaved]);

  const [selectedPath, setSelectedPath] = useState<string>(model.objects[0]?.path ?? '');
  const selected: ContentObject | undefined = objects.find((o) => o.path === selectedPath);

  const [edit, setEdit] = useState<EditState>(() => {
    const first = model.objects[0];
    return { data: { ...(first?.data ?? {}) }, body: first?.body ?? '' };
  });
  const [editingPath, setEditingPath] = useState(selectedPath);
  // A counter bumped only on an EXTERNAL body re-seed (switching objects, restoring a
  // draft) — never on the editor's own keystrokes. The Milkdown editor is keyed on it
  // so it re-seeds when the document changes but is NOT rebuilt (and blurred) on every
  // edit; the blur otherwise dropped the caret so the next key escaped the editor.
  const [bodySeed, setBodySeed] = useState(0);
  // On selection change, restore an in-progress edit (autosave) if present, so
  // switching objects never loses unsaved work; else seed from the model.
  if (selected && editingPath !== selectedPath) {
    setEditingPath(selectedPath);
    const dirty = autosave.getDirtyObject(selectedPath);
    setEdit(dirty ? { data: { ...dirty.data }, body: dirty.body } : { data: { ...selected.data }, body: selected.body });
    setBodySeed((s) => s + 1);
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
            if (draft.path === selectedPath) {
              setEdit({ data: { ...draft.data }, body: draft.body });
              setBodySeed((s) => s + 1); // external re-seed → re-mount the body editor
            }
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

  // Create a new draft object (SPEC §5): unique slug within its type, seeded front
  // matter, staged as an unsaved edit + IndexedDB draft; autosave commits its
  // index.md to the WIP branch like any other edit.
  function createObject(schema: ContentTypeSchema, title: string): void {
    const taken = new Set(objects.filter((o) => o.type === schema.name).map((o) => o.slug));
    const created = newObject(schema.name, title, schema, taken);
    setObjects((prev) => [...prev, created]);
    setSelectedPath(created.path);
    autosave.markObjectDirty(created.path, created.data, created.body);
    void draftStore.current?.put(repoKey, created.path, created.data, created.body);
    setShowNew(false);
  }

  // Delete an object's whole bundle (index.md + colocated assets from the loaded
  // tree). markPathsDeleted drops any pending edit and schedules the removal in the
  // next coalesced WIP commit; the local draft is cleared too.
  function confirmDelete(target: ContentObject): void {
    const bundleDir = target.path.replace(/\/index\.md$/, '');
    const bundleFiles = [
      target.path,
      ...session.treeEntries
        .filter((e) => e.type === 'blob' && e.path.startsWith(`${bundleDir}/`) && e.path !== target.path)
        .map((e) => e.path),
    ];
    autosave.markPathsDeleted(bundleFiles);
    void draftStore.current?.delete(repoKey, target.path);

    const remaining = objects.filter((o) => o.path !== target.path);
    setObjects(remaining);
    if (selectedPath === target.path) setSelectedPath(remaining[0]?.path ?? '');
    setDeleteTarget(null);
  }

  // Rename the selected object's slug (SPEC §5): append the old slug to `aliases` (so
  // the build emits a redirect stub), move the bundle (index.md rewritten + old
  // deleted + colocated assets moved by blob SHA), rewrite any front-matter paths that
  // pointed into the old bundle, and migrate the local draft. References store the id,
  // so nothing else needs touching.
  function renameObject(newSlug: string): void {
    if (!selected) return;
    const oldPath = selected.path;
    const oldDir = `content/${selected.type}/${selected.slug}`;
    const newDir = `content/${selected.type}/${newSlug}`;
    const newPath = `${newDir}/index.md`;

    const prevAliases = Array.isArray(edit.data.aliases)
      ? edit.data.aliases.filter((a): a is string => typeof a === 'string')
      : [];
    const aliases = prevAliases.includes(selected.slug) ? prevAliases : [...prevAliases, selected.slug];

    // Repoint any front-matter value (e.g. an image field) that lived in the bundle.
    const data: FrontMatter = { aliases };
    for (const [k, v] of Object.entries(edit.data)) {
      if (k === 'aliases') continue;
      data[k] = typeof v === 'string' && v.startsWith(`${oldDir}/`) ? `${newDir}/${v.slice(oldDir.length + 1)}` : v;
    }

    const moves = session.treeEntries
      .filter((e) => e.type === 'blob' && e.path.startsWith(`${oldDir}/`) && e.path !== oldPath)
      .map((e) => ({ from: e.path, to: `${newDir}/${e.path.slice(oldDir.length + 1)}`, sha: e.sha }));

    autosave.markObjectRenamed(oldPath, newPath, data, edit.body, moves);
    void draftStore.current?.delete(repoKey, oldPath);
    void draftStore.current?.put(repoKey, newPath, data, edit.body);

    const renamed: ContentObject = { ...selected, slug: newSlug, path: newPath, data };
    setObjects((prev) => prev.map((o) => (o.path === oldPath ? renamed : o)));
    setEdit({ data: { ...data }, body: edit.body });
    setEditingPath(newPath);
    setSelectedPath(newPath);
    setShowRename(false);
  }

  const validation = useMemo(() => {
    if (!selected || !schema) return undefined;
    const candidate: ContentObject = {
      ...selected,
      data: edit.data,
      body: edit.body,
      public: edit.data.public === true,
    };
    return validator.validateObject(candidate, workingModel);
  }, [selected, schema, edit, validator, workingModel]);

  // Header change counts ("Editing 1 · Saved 4"), tallied over the working objects.
  const counts = useMemo(
    () => summarizeChanges(objects.map((o) => o.path), autosave.editingPaths, savedPaths),
    [objects, autosave.editingPaths, savedPaths],
  );
  const hasChanges = counts.editing > 0 || counts.saved > 0;

  // Whether the selected type renders as a page — visibility (Draft/Public) only
  // applies to those; a config singleton (page: false) has no public presence.
  const isPageType = schema ? schema.page !== false : false;

  // Drive the Publish button's morph from the deploy poll while a build is running.
  useEffect(() => {
    if (publishPhase !== 'building') return;
    if (deployState === 'published') {
      setPublishPhase('done');
      void refreshSaved(); // WIP was reset to the new main → "Saved" clears
    } else if (deployState === 'failed') {
      setPublishPhase('failed');
    }
  }, [deployState, publishPhase, refreshSaved]);

  // Publish: flush any pending edits to WIP first (so they're included), record the
  // current deploy baseline, then open the review dialog.
  async function startPublish(): Promise<void> {
    if (publishPhase === 'building' || publishPhase === 'publishing') return;
    setPublishPhase('idle'); // clear a prior done/failed
    autosave.saveNow();
    try {
      const latest = await session.client.getLatestWorkflowRun(DEPLOY_WORKFLOW, session.defaultBranch);
      setDeploySince(latest?.createdAt);
    } catch {
      setDeploySince(undefined);
    }
    setShowPublish(true);
  }

  // Retry after a *deploy-leg* failure. The 'failed' phase is only ever reached from
  // 'building' — i.e. the squash-merge to main already succeeded and it was the Pages
  // deploy that failed (often a transient "try again later"). WIP was reset to main, so
  // there is nothing left to publish; recovery is re-running the deploy workflow. We
  // baseline `deploySince` on the failed run so the poll waits for the *new* run.
  async function retryDeploy(): Promise<void> {
    setPublishPhase('building');
    try {
      const latest = await session.client.getLatestWorkflowRun(DEPLOY_WORKFLOW, session.defaultBranch);
      setDeploySince(latest?.createdAt);
      await session.client.dispatchWorkflow(DEPLOY_WORKFLOW, session.defaultBranch);
    } catch (err) {
      console.warn('[timber] deploy retry failed to dispatch', err);
      setPublishPhase('failed');
    }
  }

  // Toggle the selected object's Draft/Public flag (SPEC §5). Writes `public` to front
  // matter (an undeclared key the tolerant validator passes through) and mirrors it
  // onto the working object so the sidebar badge + publish validity gate update live.
  function toggleVisibility(): void {
    if (!selected) return;
    const next = !(edit.data.public === true);
    updateField('public', next ? true : undefined);
    setObjects((prev) => prev.map((o) => (o.path === selected.path ? { ...o, public: next } : o)));
  }

  return (
    <div className="app">
      <aside className="app__sidebar">
        <h1 className="app__brand">Timber</h1>
        <p className="app__repo">
          <code>{session.loadedRef}</code>
        </p>
        <ChangesSummary
          editing={counts.editing}
          saved={counts.saved}
          syncState={autosave.syncState}
          onSaveNow={autosave.saveNow}
        />
        <PublishButton
          phase={publishPhase}
          hasChanges={hasChanges}
          onPublish={() => void (publishPhase === 'failed' ? retryDeploy() : startPublish())}
        />
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
          <div className="object-list__head">
            <span>Content</span>
            <button type="button" className="object-list__new" onClick={() => setShowNew(true)}>
              ＋ New
            </button>
          </div>
          <ul className="object-list">
            {objects.map((o) => (
              <li key={o.path}>
                <button
                  type="button"
                  className={o.path === selectedPath ? 'is-active' : ''}
                  onClick={() => setSelectedPath(o.path)}
                >
                  <span className="object-list__title">
                    <ChangeBadge state={objectChangeState(o.path, autosave.editingPaths, savedPaths)} />
                    {String(o.data.title ?? o.slug)}
                  </span>
                  <span className="object-list__type">
                    {(model.schemas.get(o.type)?.page ?? true) ? <VisibilityBadge isPublic={o.public} /> : null}
                    {o.type}
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
              <div className="editor-header__title">
                <h2>{String(edit.data.title ?? selected.slug)}</h2>
                <code>{selected.path}</code>
              </div>
              <div className="editor-header__actions">
                {isPageType ? (
                  <button
                    type="button"
                    className={`editor-header__visibility is-${edit.data.public === true ? 'public' : 'draft'}`}
                    onClick={toggleVisibility}
                    title={
                      edit.data.public === true
                        ? 'Public — appears on the live site. Click to make it a draft.'
                        : 'Draft — hidden from the live site. Click to make it public.'
                    }
                  >
                    <VisibilityBadge isPublic={edit.data.public === true} />
                    {edit.data.public === true ? 'Public' : 'Draft'}
                  </button>
                ) : null}
                {selected.kind === 'collection' ? (
                  <>
                    <button type="button" className="editor-header__rename" onClick={() => setShowRename(true)}>
                      Rename
                    </button>
                    <button
                      type="button"
                      className="editor-header__delete"
                      onClick={() => setDeleteTarget(selected)}
                    >
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </header>

            <section className="editor-panel">
              <h3>Fields</h3>
              <SchemaForm
                schema={schema}
                data={edit.data}
                model={workingModel}
                assetStore={assetStore}
                bundleDir={selected.path.replace(/\/index\.md$/, '')}
                onAssetStaged={autosave.markAssetDirty}
                onChange={updateField}
              />
            </section>

            <section className="editor-panel">
              <h3>Body</h3>
              <BodyEditor docKey={bodySeed} value={edit.body} onChange={(body) => applyEdit({ ...edit, body })} />
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

      {showNew ? (
        <NewObjectDialog model={workingModel} onClose={() => setShowNew(false)} onCreate={createObject} />
      ) : null}

      {deleteTarget ? (
        <DeleteDialog
          object={deleteTarget}
          model={workingModel}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => confirmDelete(deleteTarget)}
        />
      ) : null}

      {showRename && selected ? (
        <RenameDialog
          object={selected}
          takenSlugs={new Set(objects.filter((o) => o.type === selected.type && o.path !== selected.path).map((o) => o.slug))}
          onClose={() => setShowRename(false)}
          onRename={renameObject}
        />
      ) : null}

      {showPublish ? (
        <PublishDialog
          client={session.client}
          ctx={{ wipBranch: session.wipBranch, defaultBranch: session.defaultBranch, baseSha }}
          onClose={() => setShowPublish(false)}
          onPublished={(sha) => {
            setBaseSha(sha);
            setShowPublish(false);
            setPublishPhase('building'); // hand off to the button morph; deploy poll takes over
            void refreshSaved(); // WIP reset to the new main → "Saved" clears immediately
          }}
        />
      ) : null}
    </div>
  );
}
