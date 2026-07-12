import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canPublish,
  Validator,
  type ContentModel,
  type ContentObject,
  type ContentTypeSchema,
} from '@timber/content';
import type { FrontMatter } from '@timber/generator';
import { RepoClient } from '@timber/github';
import type { RepoSession } from './state/repoSession.js';
import { AssetStore } from './state/assets.js';
import { useAutosave } from './state/autosave.js';
import { LocalDraftStore } from './state/localDraft.js';
import { reassembleDocument } from './content/document.js';
import { repoConfig } from './github/config.js';
import { buildInfo, canCheckForUpdate } from './github/buildInfo.js';
import { getToken } from './github/auth.js';
import { useUpstreamVersion } from './state/upstreamVersion.js';
import { UpdateBanner, type UpdatePhase } from './components/UpdateBanner.js';
import { SchemaForm } from './forms/SchemaForm.js';
import { BodyEditor } from './editor/BodyEditor.js';
import { Preview } from './preview/Preview.js';
import { useRenderedPreview } from './preview/useRenderedPreview.js';
import { usePreviewWindow } from './preview/usePreviewWindow.js';
import {
  ChangesSummary,
  PublishButton,
  VisibilityBadge,
  type PublishPhase,
} from './components/ChangeBadges.js';
import { ContentList } from './components/ContentList.js';
import { PreviewControls } from './components/LayoutControls.js';
import {
  useLayout,
  MIN_MAIN_WIDTH,
  MIN_PREVIEW_WIDTH,
  type PreviewMode,
} from './state/layout.js';
import { PublishDialog } from './components/PublishDialog.js';
import { objectChangeState, summarizeChanges } from './state/changes.js';
import { useDeployPoll } from './state/useDeployPoll.js';
import { NewObjectDialog } from './components/NewObjectDialog.js';
import { DeleteDialog } from './components/DeleteDialog.js';
import { DiscardDialog } from './components/DiscardDialog.js';
import { RenameDialog } from './components/RenameDialog.js';
import { planBundleReset } from './state/discard.js';
import { parseFrontMatter } from '@timber/generator';
import { useAdvanced } from './advanced/useAdvanced.js';
import { AdvancedPreview } from './advanced/AdvancedPreview.js';
import { CodeEditor } from './advanced/CodeEditor.js';
import { CheatSheet } from './advanced/CheatSheet.js';
import { NewTypeDialog } from './components/NewTypeDialog.js';
import { schemaNameFromPath } from './advanced/schemaTemplate.js';
import { canAccessAdvanced } from './github/access.js';
import { newObject } from './content/newObject.js';
import { useBackNavigationGuard } from './editor/backNavGuard.js';

/** The deploy workflow's file name (the site-template ships deploy.yml). */
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
  // Live objects plus any pending deletions carried over from a prior session (removed
  // on WIP, still on main) — the latter render struck-through with a Restore action.
  const [objects, setObjects] = useState<ContentObject[]>(() => [
    ...model.objects,
    ...session.deletedObjects.map((d) => d.object),
  ]);
  const workingModel: ContentModel = useMemo(
    () => ({
      ...model,
      objects,
      byId: new Map(objects.filter((o) => o.id).map((o) => [o.id as string, o] as const)),
    }),
    [model, objects],
  );
  const [showNew, setShowNew] = useState(false);
  const [showNewType, setShowNewType] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContentObject | null>(null);
  const [discardTarget, setDiscardTarget] = useState<ContentObject | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [showRename, setShowRename] = useState(false);
  // Objects marked for deletion: kept in the list (struck-through, restorable) rather
  // than vanishing, so a pending delete reads as the reversible change it is (SPEC §5).
  // Seeded from the branch (prior-session deletions), then updated as you delete/restore.
  const [deletedPaths, setDeletedPaths] = useState<ReadonlySet<string>>(
    () => new Set(session.deletedObjects.map((d) => d.object.path)),
  );
  // Bundle asset SHAs for branch-derived deletions, so Restore can re-attach the bytes
  // (they're gone from the WIP tree, so `session.treeEntries` can't supply them).
  const deletedAssets = useMemo(
    () => new Map(session.deletedObjects.map((d) => [d.object.path, d.assets] as const)),
    [session],
  );

  // Content editing vs. the advanced/admin area (templates + config), gated by the
  // canAccessAdvanced() seam (SPEC §8/§10). Both share this one session + autosave, so
  // switching never drops unsaved state and edits coalesce into the same WIP commit.
  const advancedAllowed = canAccessAdvanced();
  const [view, setView] = useState<'content' | 'advanced'>('content');
  // Only load advanced files once the user first opens that view (lazy). Once seen,
  // the hook keeps its state so switching back and forth is instant.
  const [advancedSeen, setAdvancedSeen] = useState(false);

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

  // --- Out-of-date editor check (SPEC §12) ------------------------------------------
  // The editor bundle is built from a pinned Timber checkout; when the branch it follows
  // moves on, this deployed copy is stale. A client bound to the *upstream* Timber repo
  // (not the site repo) lets us compare the built-from SHA against that branch's tip.
  const canCheck = canCheckForUpdate(buildInfo);
  const upstreamClient = useMemo(
    () =>
      canCheck && buildInfo.upstream
        ? new RepoClient({ ...buildInfo.upstream, getToken })
        : undefined,
    [canCheck],
  );
  const update = useUpstreamVersion(
    upstreamClient,
    buildInfo.ref,
    buildInfo.sha,
    canCheck,
  );

  // A triggered update reuses the deploy workflow + poll: dispatching deploy.yml rebuilds
  // the site AND the editor from the latest Timber. `updatePhase` drives the banner; the
  // poll (baselined on the pre-dispatch run) tells us when the rebuild has landed.
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle');
  const [updateSince, setUpdateSince] = useState<string | undefined>(undefined);
  const updateDeployState = useDeployPoll(
    session.client,
    DEPLOY_WORKFLOW,
    session.defaultBranch,
    updatePhase === 'updating',
    updateSince,
  );
  useEffect(() => {
    if (updatePhase !== 'updating') return;
    // The freshly deployed bundle is live once the run completes, but this tab is still
    // running the old code — surface a Reload rather than swapping under the user.
    if (updateDeployState === 'published') setUpdatePhase('done');
    else if (updateDeployState === 'failed') setUpdatePhase('failed');
  }, [updateDeployState, updatePhase]);

  // Trigger (or retry) a redeploy that ships the newer Timber. Baseline the poll on the
  // current latest run so a stale completed deploy can't read as our new one.
  async function startUpdate(): Promise<void> {
    setUpdatePhase('updating');
    try {
      const latest = await session.client.getLatestWorkflowRun(
        DEPLOY_WORKFLOW,
        session.defaultBranch,
      );
      setUpdateSince(latest?.createdAt);
      await session.client.dispatchWorkflow(DEPLOY_WORKFLOW, session.defaultBranch);
    } catch (err) {
      console.warn('[timber] editor update failed to dispatch', err);
      setUpdatePhase('failed');
    }
  }

  // Objects committed to WIP but not yet on main ("Saved"). Refreshed on load and
  // after each successful autosave/publish. `editingPaths` (local-only) comes from the
  // autosaver; an object that's both counts as Editing (the furthest-back state).
  const [savedPaths, setSavedPaths] = useState<ReadonlySet<string>>(new Set());
  // Index.md paths that are `added` on WIP (brand-new, not yet on main) — lets the
  // discard dialog say "remove it" vs "revert to published".
  const [addedIndexPaths, setAddedIndexPaths] = useState<ReadonlySet<string>>(new Set());
  const refreshSaved = useCallback(async () => {
    try {
      const changed = await session.client.compareChangedPaths(
        session.defaultBranch,
        session.wipBranch,
      );
      setSavedPaths(new Set(changed.map((c) => c.path)));
      setAddedIndexPaths(
        new Set(
          changed
            .filter((c) => c.status === 'added' && c.path.endsWith('/index.md'))
            .map((c) => c.path),
        ),
      );
    } catch {
      // WIP branch may not exist yet (nothing saved) — nothing published-pending.
      setSavedPaths(new Set());
      setAddedIndexPaths(new Set());
    }
  }, [session]);
  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);
  useEffect(() => {
    if (autosave.syncState === 'saved') void refreshSaved();
  }, [autosave.syncState, refreshSaved]);

  const [selectedPath, setSelectedPath] = useState<string>(model.objects[0]?.path ?? '');
  const selected: ContentObject | undefined = objects.find(
    (o) => o.path === selectedPath,
  );

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
    setEdit(
      dirty
        ? { data: { ...dirty.data }, body: dirty.body }
        : { data: { ...selected.data }, body: selected.body },
    );
    setBodySeed((s) => s + 1);
  }

  const schema = selected ? model.schemas.get(selected.type) : undefined;
  const selectedDeleted = selected ? deletedPaths.has(selected.path) : false;

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
    const taken = new Set(
      objects.filter((o) => o.type === schema.name).map((o) => o.slug),
    );
    const created = newObject(schema.name, title, schema, taken);
    setObjects((prev) => [...prev, created]);
    setSelectedPath(created.path);
    autosave.markObjectDirty(created.path, created.data, created.body);
    void draftStore.current?.put(repoKey, created.path, created.data, created.body);
    setShowNew(false);
  }

  // The colocated asset paths of an object's bundle (everything under its dir except
  // index.md), from the tree loaded at session start. Powers delete (remove them all)
  // and restore (re-attach them by blob SHA).
  function bundleAssetEntries(target: ContentObject): { path: string; sha: string }[] {
    const bundleDir = target.path.replace(/\/index\.md$/, '');
    return session.treeEntries
      .filter(
        (e) =>
          e.type === 'blob' &&
          e.path.startsWith(`${bundleDir}/`) &&
          e.path !== target.path,
      )
      .map((e) => ({ path: e.path, sha: e.sha }));
  }

  // Delete an object's whole bundle (index.md + colocated assets). Rather than making
  // it vanish, keep it in the list marked "deleting" (struck-through, restorable) and
  // schedule the removal in the next coalesced WIP commit. The local draft is cleared;
  // the in-memory object still holds its data/body so Restore can re-add it.
  function confirmDelete(target: ContentObject): void {
    const bundleFiles = [target.path, ...bundleAssetEntries(target).map((e) => e.path)];
    autosave.markPathsDeleted(bundleFiles);
    void draftStore.current?.delete(repoKey, target.path);
    setDeletedPaths((prev) => new Set(prev).add(target.path));
    setDeleteTarget(null);
  }

  // Restore a pending-delete object: cancel the scheduled deletion and re-add the
  // bundle (rewrite index.md + re-attach assets by reusing their blob SHAs). If the
  // delete hadn't been committed yet this is a near no-op; either way the object is a
  // live, editable change again.
  function restoreObject(target: ContentObject): void {
    // Prefer the branch-derived asset SHAs (prior-session delete); fall back to the WIP
    // tree for an object deleted in this session (its assets are still in treeEntries).
    const assets = deletedAssets.get(target.path) ?? bundleAssetEntries(target);
    const moves = assets.map((e) => ({ from: e.path, to: e.path, sha: e.sha }));
    autosave.markObjectRestored(target.path, target.data, target.body, moves);
    void draftStore.current?.put(repoKey, target.path, target.data, target.body);
    setDeletedPaths((prev) => {
      const next = new Set(prev);
      next.delete(target.path);
      return next;
    });
  }

  // Discard a page's unpublished changes (SPEC §5): revert its bundle to the published
  // (main) version. Drops local pending state first, then commits a reset to WIP
  // (main's blobs re-attached, WIP-only files deleted), and reseeds the editor from
  // main. A brand-new page (never published) has no version to revert to, so it's
  // removed. The whole thing is one deliberate commit, like publish — not autosave.
  async function discardChanges(target: ContentObject): Promise<void> {
    const bundleDir = target.path.replace(/\/index\.md$/, '');
    setDiscarding(true);
    try {
      autosave.forgetBundle(bundleDir); // stop autosave re-committing what we discard

      let bundleChanges: Awaited<ReturnType<typeof session.client.compareChangedPaths>> =
        [];
      try {
        const changed = await session.client.compareChangedPaths(
          session.defaultBranch,
          session.wipBranch,
        );
        bundleChanges = changed.filter((c) => c.path.startsWith(`${bundleDir}/`));
      } catch {
        // No WIP branch yet → nothing committed to revert; only local edits to drop.
      }

      // Is there a published version to revert to?
      let published: string | null = null;
      try {
        published = await session.client.readFile(target.path, session.defaultBranch);
      } catch {
        published = null;
      }

      if (published === null) {
        // Brand-new page: remove it (delete any WIP copy of the bundle) and drop it.
        if (bundleChanges.length > 0) {
          await session.client.commitFiles({
            branch: session.wipBranch,
            baseBranch: session.defaultBranch,
            message: `discard new ${bundleDir.split('/').pop()}`,
            files: [],
            deletions: bundleChanges.map((c) => c.path),
          });
        }
        void draftStore.current?.delete(repoKey, target.path);
        const remaining = objects.filter((o) => o.path !== target.path);
        setObjects(remaining);
        if (selectedPath === target.path) setSelectedPath(remaining[0]?.path ?? '');
        await refreshSaved();
        return;
      }

      // Reset the bundle's WIP state back to main (if anything is committed there).
      if (bundleChanges.length > 0) {
        const mainTree = await session.client.loadTree(session.defaultBranch);
        const mainSha = new Map(
          mainTree.entries
            .filter((e) => e.type === 'blob')
            .map((e) => [e.path, e.sha] as const),
        );
        const { moves, deletions } = planBundleReset(bundleChanges, mainSha);
        if (moves.length > 0 || deletions.length > 0) {
          await session.client.commitFiles({
            branch: session.wipBranch,
            baseBranch: session.defaultBranch,
            message: `discard changes to ${bundleDir.split('/').pop()}`,
            files: [],
            moves,
            deletions,
          });
        }
      }

      // Reseed the in-memory object + editor from the published version.
      const { data, body } = parseFrontMatter(published);
      const restored: ContentObject = {
        ...target,
        data,
        body,
        public: data.public === true,
      };
      setObjects((prev) => prev.map((o) => (o.path === target.path ? restored : o)));
      if (selectedPath === target.path) {
        setEdit({ data: { ...data }, body });
        setBodySeed((s) => s + 1);
      }
      void draftStore.current?.delete(repoKey, target.path);
      await refreshSaved();
    } catch (err) {
      console.warn('[timber] discard changes failed', err);
      await refreshSaved(); // resync the badges to the true branch state
    } finally {
      setDiscarding(false);
      setDiscardTarget(null);
    }
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
    const aliases = prevAliases.includes(selected.slug)
      ? prevAliases
      : [...prevAliases, selected.slug];

    // Repoint any front-matter value (e.g. an image field) that lived in the bundle.
    const data: FrontMatter = { aliases };
    for (const [k, v] of Object.entries(edit.data)) {
      if (k === 'aliases') continue;
      data[k] =
        typeof v === 'string' && v.startsWith(`${oldDir}/`)
          ? `${newDir}/${v.slice(oldDir.length + 1)}`
          : v;
    }

    const moves = session.treeEntries
      .filter(
        (e) => e.type === 'blob' && e.path.startsWith(`${oldDir}/`) && e.path !== oldPath,
      )
      .map((e) => ({
        from: e.path,
        to: `${newDir}/${e.path.slice(oldDir.length + 1)}`,
        sha: e.sha,
      }));

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
    () =>
      summarizeChanges(
        objects.map((o) => o.path),
        autosave.editingPaths,
        savedPaths,
        deletedPaths,
      ),
    [objects, autosave.editingPaths, savedPaths, deletedPaths],
  );
  const hasChanges = counts.editing > 0 || counts.saved > 0 || counts.deleting > 0;

  // Whether the selected type renders as a page — visibility (Draft/Public) only
  // applies to those; a config singleton (page: false) has no public presence.
  const isPageType = schema ? schema.page !== false : false;
  // Whether the selected type carries a Markdown body. A config singleton like
  // `settings` sets `hasBody: false`; the generator strips its body on assemble, so
  // showing the body editor would only invite edits that get silently discarded.
  const hasBody = schema ? schema.hasBody !== false : false;

  // The selected page's change state — gates the header "Discard changes" button
  // (shown only when the page has pending edits, and never for a pending-delete page).
  const selectedState =
    selected && !selectedDeleted
      ? objectChangeState(selected.path, autosave.editingPaths, savedPaths)
      : 'clean';
  const canDiscard = selectedState === 'editing' || selectedState === 'saved';

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
      const latest = await session.client.getLatestWorkflowRun(
        DEPLOY_WORKFLOW,
        session.defaultBranch,
      );
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
      const latest = await session.client.getLatestWorkflowRun(
        DEPLOY_WORKFLOW,
        session.defaultBranch,
      );
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
    setObjects((prev) =>
      prev.map((o) => (o.path === selected.path ? { ...o, public: next } : o)),
    );
  }

  // Advanced/admin state (templates + config), lazily loaded on first visit. Its file
  // list renders in the shared sidebar and its editor/preview in the shared work area.
  const advanced = useAdvanced(session, autosave, advancedSeen);

  // ---- Layout: banner + drawer sidebar + split/tab/off preview (SPEC §8) ----------
  const layout = useLayout();
  function openView(next: 'content' | 'advanced'): void {
    if (next === 'advanced') setAdvancedSeen(true);
    setView(next);
    if (layout.isMobile) layout.setSidebarOpen(false);
  }
  // Side-by-side isn't workable on a phone, so a narrow viewport downgrades it to tabs.
  const effectivePreviewMode: PreviewMode =
    layout.isMobile && layout.previewMode === 'split' ? 'tab' : layout.previewMode;
  const showMain = effectivePreviewMode !== 'tab' || layout.previewTab === 'edit';
  const showPreviewPane =
    effectivePreviewMode === 'split' ||
    (effectivePreviewMode === 'tab' && layout.previewTab === 'preview');

  // Render the content preview once, here, so the same HTML feeds both the pane and a
  // popped-out window. Skip the work entirely when nothing needs it (advanced view has
  // its own template preview). The pop-out's open state is read from a ref (previous
  // render's value) to keep hook order stable — a one-render lag on first open is fine.
  const previewWindowOpenRef = useRef(false);
  const previewLive = view === 'content' && !!selected && !selectedDeleted;
  const { html: previewHtml, error: previewError } = useRenderedPreview(
    edit.data,
    edit.body,
    assetStore,
    previewLive && (showPreviewPane || previewWindowOpenRef.current),
  );
  const previewWin = usePreviewWindow(previewHtml, previewError);
  previewWindowOpenRef.current = previewWin.isOpen;

  // Drag the split divider to resize the preview pane; persist the width on drop.
  // Starting width is the current pane width (measured when we're at the equal default).
  const workRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  function onDividerDown(e: React.PointerEvent<HTMLDivElement>): void {
    e.preventDefault();
    const startX = e.clientX;
    const startW =
      layout.previewWidth ?? previewRef.current?.offsetWidth ?? MIN_PREVIEW_WIDTH;
    let last = startW;
    const move = (ev: PointerEvent): void => {
      const container = workRef.current;
      const maxW = container
        ? container.clientWidth - MIN_MAIN_WIDTH
        : Number.POSITIVE_INFINITY;
      last = Math.max(MIN_PREVIEW_WIDTH, Math.min(maxW, startW - (ev.clientX - startX)));
      layout.setPreviewWidth(last, false);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      layout.setPreviewWidth(last, true);
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Keyboard shortcuts for the two layout toggles (⌘/Ctrl-B sidebar, ⌘/Ctrl-. cycles
  // the preview mode). Modifier-gated so they never intercept editor typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        layout.toggleSidebar();
      } else if (e.key === '.') {
        e.preventDefault();
        const order: PreviewMode[] = ['split', 'tab', 'off'];
        const next =
          order[(order.indexOf(layout.previewMode) + 1) % order.length] ?? 'split';
        layout.setPreviewMode(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout.toggleSidebar, layout.setPreviewMode, layout.previewMode]);

  // The work area's two panes, rendered into the shared split/tab/off scaffold below.
  // Content and advanced share the same chrome; only the inner editor + preview differ.
  const mainContent =
    view === 'advanced' ? (
      advanced.loadError ? (
        <p className="advanced__load">
          Couldn’t load advanced files: {advanced.loadError}
        </p>
      ) : !advanced.files ? (
        <p>Loading templates &amp; config…</p>
      ) : advanced.selected ? (
        <>
          <header className="editor-header">
            <div className="editor-header__title">
              <h2>{advanced.selected.path.split('/').pop()}</h2>
              <code>{advanced.selected.path}</code>
            </div>
          </header>
          <section className="editor-panel">
            <CodeEditor
              value={advanced.value}
              kind={advanced.selected.kind}
              onChange={advanced.onEdit}
            />
            {advanced.validation && !advanced.validation.valid ? (
              <div
                className="advanced__validation advanced__validation--bad"
                role="alert"
              >
                <strong>
                  Not saved to your branch — fix before it can be committed:
                </strong>
                <ul>
                  {advanced.validation.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                <p className="advanced__hint">
                  Your draft is kept locally so nothing is lost.
                </p>
              </div>
            ) : (
              <div className="advanced__validation advanced__validation--ok">
                ✓ Valid — saved to your branch
              </div>
            )}
            {advanced.selected.kind === 'schema' ? <CheatSheet /> : null}
          </section>
        </>
      ) : (
        <p>No editable file selected.</p>
      )
    ) : selected && selectedDeleted ? (
      <section className="deleted-panel" aria-label="Deleted object">
        <h2>
          <span aria-hidden="true">✕</span> “
          {String(selected.data.title ?? selected.slug)}” is marked for deletion
        </h2>
        <p>
          <code>{selected.path.replace(/\/index\.md$/, '/')}</code> will be removed from
          the live site when you publish. Until then it stays here as a pending change —
          you can bring it back.
        </p>
        <button
          type="button"
          className="deleted-panel__restore"
          onClick={() => restoreObject(selected)}
        >
          Restore
        </button>
      </section>
    ) : selected && schema ? (
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
            {canDiscard || selected.kind === 'collection' ? (
              <details className="overflow-menu">
                <summary
                  className="overflow-menu__toggle"
                  aria-label="More actions"
                  title="More actions"
                >
                  ⋯
                </summary>
                <div className="overflow-menu__items">
                  {canDiscard ? (
                    <button
                      type="button"
                      className="editor-header__discard"
                      onClick={() => setDiscardTarget(selected)}
                      title="Discard this page's unpublished changes — revert it to the published version."
                    >
                      Discard changes
                    </button>
                  ) : null}
                  {selected.kind === 'collection' ? (
                    <>
                      <button
                        type="button"
                        className="editor-header__rename"
                        onClick={() => setShowRename(true)}
                      >
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
              </details>
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

        {hasBody ? (
          <section className="editor-panel">
            <h3>Body</h3>
            <BodyEditor
              docKey={bodySeed}
              value={edit.body}
              onChange={(body) => applyEdit({ ...edit, body })}
            />
          </section>
        ) : null}

        {validation ? (
          <section
            className={`validation ${validation.valid ? 'validation--ok' : 'validation--bad'}`}
          >
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
    );

  const previewContent =
    view === 'advanced' ? (
      advanced.selected ? (
        <AdvancedPreview
          session={session}
          kind={advanced.selected.kind}
          template={advanced.value}
          valid={advanced.validation?.valid ?? false}
        />
      ) : null
    ) : selected && !selectedDeleted ? (
      <Preview html={previewHtml} error={previewError} />
    ) : (
      <p className="app__preview-empty">Nothing to preview.</p>
    );

  // The banner rides the whole time an update is offered or in flight; it only vanishes
  // once dismissed by a reload (phase never leaves 'done' without one).
  const showUpdateBanner = update.state === 'outdated' || updatePhase !== 'idle';

  return (
    <div className="app">
      {showUpdateBanner ? (
        <UpdateBanner
          behindBy={update.behindBy}
          phase={updatePhase}
          onUpdate={() => void startUpdate()}
          onReload={() => window.location.reload()}
        />
      ) : null}
      <header className="app__banner">
        <div className="app__banner-left">
          <button
            type="button"
            className="app__menu-btn"
            onClick={() => layout.toggleSidebar()}
            aria-label={layout.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-expanded={layout.sidebarOpen}
            title="Toggle sidebar (⌘/Ctrl-B)"
          >
            ☰
          </button>
          <h1 className="app__brand">Timber</h1>
          <code className="app__repo app__repo--banner">{session.loadedRef}</code>
          <ChangesSummary
            editing={counts.editing}
            saved={counts.saved}
            deleting={counts.deleting}
            syncState={autosave.syncState}
            onSaveNow={autosave.saveNow}
          />
        </div>
        <div className="app__banner-right">
          <PreviewControls
            mode={layout.previewMode}
            effectiveMode={effectivePreviewMode}
            tab={layout.previewTab}
            isMobile={layout.isMobile}
            popOutOpen={previewWin.isOpen}
            showPopOut={view === 'content'}
            onMode={layout.setPreviewMode}
            onTab={layout.setPreviewTab}
            onPopOut={() => (previewWin.isOpen ? previewWin.close() : previewWin.open())}
          />
          <PublishButton
            phase={publishPhase}
            hasChanges={hasChanges}
            onPublish={() =>
              void (publishPhase === 'failed' ? retryDeploy() : startPublish())
            }
          />
        </div>
      </header>

      <div className="app__body">
        {layout.sidebarOpen ? (
          <>
            {layout.isMobile ? (
              <div
                className="app__scrim"
                onClick={() => layout.setSidebarOpen(false)}
                aria-hidden="true"
              />
            ) : null}
            <aside className="app__sidebar">
              {advancedAllowed ? (
                <div
                  className="view-toggle view-toggle--sidebar"
                  role="tablist"
                  aria-label="Editor view"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === 'content'}
                    className={view === 'content' ? 'is-active' : ''}
                    onClick={() => openView('content')}
                  >
                    Content
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === 'advanced'}
                    className={view === 'advanced' ? 'is-active' : ''}
                    onClick={() => openView('advanced')}
                  >
                    Advanced
                  </button>
                </div>
              ) : null}

              {view === 'content' ? (
                <nav>
                  <div className="object-list__head">
                    <span>Content</span>
                    <button
                      type="button"
                      className="object-list__new"
                      onClick={() => setShowNew(true)}
                    >
                      ＋ New
                    </button>
                  </div>
                  <ContentList
                    objects={objects}
                    schemas={model.schemas}
                    selectedPath={selectedPath}
                    editingPaths={autosave.editingPaths}
                    savedPaths={savedPaths}
                    deletedPaths={deletedPaths}
                    onSelect={(path) => {
                      setSelectedPath(path);
                      if (layout.isMobile) layout.setSidebarOpen(false);
                    }}
                  />
                </nav>
              ) : (
                <nav>
                  <div className="object-list__head">
                    <span>Templates &amp; config</span>
                    <button
                      type="button"
                      className="object-list__new"
                      disabled={!advanced.files}
                      onClick={() => setShowNewType(true)}
                    >
                      ＋ New type
                    </button>
                  </div>
                  {advanced.loadError ? (
                    <p className="object-list__empty">Couldn’t load files.</p>
                  ) : !advanced.files ? (
                    <p className="object-list__empty">Loading…</p>
                  ) : (
                    <ul className="object-list">
                      {advanced.files.map((f) => (
                        <li key={f.path}>
                          <button
                            type="button"
                            className={
                              f.path === advanced.selectedPath ? 'is-active' : ''
                            }
                            onClick={() => {
                              advanced.setSelectedPath(f.path);
                              if (layout.isMobile) layout.setSidebarOpen(false);
                            }}
                          >
                            <span className="object-list__title">
                              {f.path.split('/').pop()}
                            </span>
                            <span className="object-list__type">{f.path}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </nav>
              )}
            </aside>
          </>
        ) : null}

        <div
          ref={workRef}
          className={`app__work app__work--${effectivePreviewMode}`}
          style={
            effectivePreviewMode === 'split' && layout.previewWidth != null
              ? ({ '--preview-w': `${layout.previewWidth}px` } as React.CSSProperties)
              : undefined
          }
        >
          {showMain ? <main className="app__main">{mainContent}</main> : null}

          {effectivePreviewMode === 'split' && showPreviewPane ? (
            <div
              className="app__divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Drag to resize preview"
              onPointerDown={onDividerDown}
            />
          ) : null}

          {showPreviewPane ? (
            <aside className="app__preview" ref={previewRef}>
              <h3>Preview</h3>
              {previewContent}
            </aside>
          ) : null}
        </div>
      </div>

      {showNew ? (
        <NewObjectDialog
          model={workingModel}
          onClose={() => setShowNew(false)}
          onCreate={createObject}
        />
      ) : null}

      {showNewType ? (
        <NewTypeDialog
          existingNames={
            new Set([
              ...model.schemas.keys(),
              ...(advanced.files ?? [])
                .map((f) => schemaNameFromPath(f.path))
                .filter((n): n is string => n !== undefined),
            ])
          }
          onClose={() => setShowNewType(false)}
          onCreate={(opts) => {
            advanced.createType(opts);
            setShowNewType(false);
          }}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteDialog
          object={deleteTarget}
          model={workingModel}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => confirmDelete(deleteTarget)}
        />
      ) : null}

      {discardTarget ? (
        <DiscardDialog
          object={discardTarget}
          brandNew={addedIndexPaths.has(discardTarget.path)}
          busy={discarding}
          onClose={() => (discarding ? undefined : setDiscardTarget(null))}
          onConfirm={() => void discardChanges(discardTarget)}
        />
      ) : null}

      {showRename && selected ? (
        <RenameDialog
          object={selected}
          takenSlugs={
            new Set(
              objects
                .filter((o) => o.type === selected.type && o.path !== selected.path)
                .map((o) => o.slug),
            )
          }
          onClose={() => setShowRename(false)}
          onRename={renameObject}
        />
      ) : null}

      {showPublish ? (
        <PublishDialog
          client={session.client}
          ctx={{
            wipBranch: session.wipBranch,
            defaultBranch: session.defaultBranch,
            baseSha,
          }}
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
