import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  assembleContent,
  canPublish,
  resolvePublic,
  withPublic,
  Validator,
  type ContentModel,
  type ContentObject,
  type ContentTypeSchema,
} from '@timber/content';
import { computeLocationReadout, type StorageLevel } from './state/location.js';
import type { RepoVisibility } from '@timber/host';
import { LocationReadout } from './components/LocationReadout.js';
import { BackupDialog } from './components/BackupDialog.js';
import type { FrontMatter, TemplateMap } from '@timber/generator';
import type { RepoSession } from './state/repoSession.js';
import { AssetStore } from './state/assets.js';
import { repoAssetLoader } from './state/assetLoader.js';
import { useAutosave } from './state/autosave.js';
import { LocalDraftStore } from './state/localDraft.js';
import { reassembleDocument } from './content/document.js';
import { mergeEditIntoObjects } from './content/editState.js';
import { repoConfig } from './host/config.js';
import { buildInfo, canCheckForUpdate } from './host/buildInfo.js';
import { getToken } from './host/auth.js';
import { createHostProvider } from './host/hostProvider.js';
import { useUpstreamVersion } from './state/upstreamVersion.js';
import { UpdateBanner, type UpdatePhase } from './components/UpdateBanner.js';
import { SchemaForm } from './forms/SchemaForm.js';
import { BodyEditor } from './editor/BodyEditor.js';
import { Preview } from './preview/Preview.js';
import { useRenderedPreview } from './preview/useRenderedPreview.js';
import { useSiteTheme } from './preview/useSiteTheme.js';
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
import { ChangesPanel, type ChangeEntry } from './components/ChangesPanel.js';
import { kindOf } from './advanced/loadAdvancedFiles.js';
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
import { AdvancedEditorPanel } from './advanced/AdvancedEditorPanel.js';
import { AdvancedList } from './advanced/AdvancedList.js';
import { AssetManager } from './advanced/AssetManager.js';
import { listSiteAssets } from './media/siteAssets.js';
import { NewTypeDialog } from './components/NewTypeDialog.js';
import { NewFileDialog } from './components/NewFileDialog.js';
import { ImportThemeDialog } from './components/ImportThemeDialog.js';
import { Wordmark } from './components/Wordmark.js';
import { schemaNameFromPath } from './advanced/schemaTemplate.js';
import { canAccessAdvanced } from './host/access.js';
import { newObject } from './content/newObject.js';
import { newTranslation } from './content/newTranslation.js';
import { AddTranslationDialog } from './components/AddTranslationDialog.js';
import { HeaderActions } from './components/HeaderActions.js';
import { useBackNavigationGuard } from './editor/backNavGuard.js';

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
  const assetStore = useMemo(() => new AssetStore(repoAssetLoader(session)), [session]);
  // Objects the author is keeping **On this device** (SPEC §5/§8 storage axis): held out
  // of the WIP commit, their sole copy the IndexedDB draft. Loaded from the draft store on
  // mount; the autosaver reads this (via a ref) to filter its commit.
  const [deviceOnlyPaths, setDeviceOnlyPaths] = useState<ReadonlySet<string>>(new Set());
  // True for a device-only object's `index.md` **or any path in its bundle** (a colocated
  // asset), so the autosaver keeps a device-only object's images out of the WIP commit too.
  const isDeviceOnlyPath = (path: string): boolean => {
    if (deviceOnlyPaths.has(path)) return true;
    for (const idx of deviceOnlyPaths) {
      if (path.startsWith(idx.slice(0, -'index.md'.length))) return true; // bundle dir + '/'
    }
    return false;
  };
  const autosave = useAutosave(session, assetStore, isDeviceOnlyPath);
  // Repo visibility (SPEC §5), for the honest "backed up = visible to whom" wording. Read
  // once through the host port; `unknown` (the default) stays conservative if it can't tell.
  const [repoVisibility, setRepoVisibility] = useState<RepoVisibility>('unknown');
  useEffect(() => {
    let cancelled = false;
    void session.client
      .getVisibility()
      .then((v) => {
        if (!cancelled) setRepoVisibility(v);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session]);
  /** Whether the host can deploy a site at all (SPEC §8 — the website stop degrades if not). */
  const canDeploy = session.client.deploy !== undefined;

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
  const workingModel: ContentModel = useMemo(() => {
    // Rebuild the translation index over the live objects too, so a translation created
    // this session immediately links its siblings (preview switcher, hreflang) — the same
    // reactive-working-model principle as the id index (SPEC §5 → Multilingual).
    const byTranslation = new Map<string, Map<string, ContentObject>>();
    for (const o of objects) {
      if (!o.translationKey) continue;
      const group = byTranslation.get(o.translationKey) ?? new Map<string, ContentObject>();
      const lang = o.lang ?? '';
      if (!group.has(lang)) group.set(lang, o);
      byTranslation.set(o.translationKey, group);
    }
    return {
      ...model,
      objects,
      byId: new Map(objects.filter((o) => o.id).map((o) => [o.id as string, o] as const)),
      byTranslation,
    };
  }, [model, objects]);

  // Site language config (SPEC §5 → Multilingual): read from the settings singleton (the
  // `page: false` type). i18n is opt-in — empty `languages` means single-language, so the
  // language badges + "Add translation" affordance simply don't appear.
  const siteI18n = useMemo(() => {
    const settings = model.objects.find((o) => model.schemas.get(o.type)?.page === false);
    const languages = Array.isArray(settings?.data.languages)
      ? settings.data.languages.filter((l): l is string => typeof l === 'string' && l.length > 0)
      : [];
    const declared = settings?.data.defaultLanguage;
    const defaultLanguage =
      typeof declared === 'string' && declared.length > 0 ? declared : (languages[0] ?? '');
    return { languages, defaultLanguage, enabled: languages.length > 0 };
  }, [model]);

  // Active theme (SPEC §13): the settings singleton's `activeTheme` selects which
  // `themes/<name>/` folder the preview renders through. Unset → legacy root theme.
  const activeTheme = useMemo(() => {
    const settings = model.objects.find((o) => model.schemas.get(o.type)?.page === false);
    const value = settings?.data.activeTheme;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }, [model]);
  const [showNew, setShowNew] = useState(false);
  const [showNewType, setShowNewType] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);
  const [showImportTheme, setShowImportTheme] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContentObject | null>(null);
  const [discardTarget, setDiscardTarget] = useState<ContentObject | null>(null);
  // The device-only object awaiting "Back up to the repo" confirmation (SPEC §5/§8).
  const [backupTarget, setBackupTarget] = useState<ContentObject | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showAddTranslation, setShowAddTranslation] = useState(false);
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
  // Within the advanced view, the asset manager (binary /assets files) is a mode toggled
  // against the text-file editor — selecting a template/config file returns to the editor.
  const [assetsActive, setAssetsActive] = useState(false);
  // Only load advanced files once the user first opens that view (lazy). Once seen,
  // the hook keeps its state so switching back and forth is instant.
  const [advancedSeen, setAdvancedSeen] = useState(false);

  // Publish dialog + the conflict base SHA, which advances each time we publish.
  const [showPublish, setShowPublish] = useState(false);
  const [baseSha, setBaseSha] = useState(session.baseSha);
  // Header changes panel (the "N changes" dropdown).
  const [showChanges, setShowChanges] = useState(false);

  // The Publish button's morph state (idle → publishing → building → done/failed) and,
  // for the deploy poll, the created-time of the newest run seen *before* we publish —
  // so a stale completed run can't be mistaken for our new one.
  const [publishPhase, setPublishPhase] = useState<PublishPhase>('idle');
  const [deploySince, setDeploySince] = useState<string | undefined>(undefined);
  const deployState = useDeployPoll(
    session.client.deploy,
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
      // Timber's own source repo is on GitHub regardless of where the *site* is hosted,
      // so the out-of-date check always uses the GitHub adapter (SPEC §12).
      canCheck && buildInfo.upstream
        ? createHostProvider({ host: 'github', ...buildInfo.upstream }, getToken)
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
  // poll (baselined on the pre-dispatch run) tells us when the rebuild has landed — only
  // then do we offer Reload, since the deploy takes ~a minute and the new bundle isn't
  // live until it finishes. `updateArmed` gates the poll so it never runs before the
  // baseline is captured: activating it with an undefined `since` would treat a prior
  // completed deploy as "ours" and flash Reload immediately (the merge/publish poll
  // avoids this by capturing its baseline well before the build phase begins).
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle');
  const [updateSince, setUpdateSince] = useState<string | undefined>(undefined);
  const [updateArmed, setUpdateArmed] = useState(false);
  const updateDeployState = useDeployPoll(
    session.client.deploy,
    session.defaultBranch,
    updatePhase === 'updating' && updateArmed,
    updateSince,
  );
  useEffect(() => {
    if (updatePhase !== 'updating') return;
    // The freshly deployed bundle is live once the run completes, but this tab is still
    // running the old code — surface a Reload rather than swapping under the user.
    if (updateDeployState === 'published') setUpdatePhase('done');
    else if (updateDeployState === 'failed') setUpdatePhase('failed');
  }, [updateDeployState, updatePhase]);

  // Trigger (or retry) a redeploy that ships the newer Timber. Show "Building…" at once
  // for feedback, but capture the pre-dispatch run as the poll baseline and dispatch
  // *before* arming the poll — so a stale completed deploy can't be mistaken for our new
  // one, and Reload only appears once the rebuild we started actually finishes.
  async function startUpdate(): Promise<void> {
    setUpdateArmed(false);
    setUpdatePhase('updating');
    try {
      const latest = await session.client.deploy?.getLatestDeploy(session.defaultBranch);
      setUpdateSince(latest?.createdAt);
      await session.client.deploy?.triggerDeploy(session.defaultBranch);
      setUpdateArmed(true);
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
  // Bumped on every saved-state refresh so the changes-panel / publish diffs refetch the
  // WIP blobs after a commit advances the branch tip (paths alone can't detect a same-path
  // content change).
  const [saveSeq, setSaveSeq] = useState(0);
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
    } finally {
      setSaveSeq((s) => s + 1);
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
  // On selection change: first fold the OUTGOING page's live buffer back into `objects`
  // (so a later return reseeds from the current edit, not the load-time data, even after
  // autosave has cleared its dirty entry), then seed the editor for the incoming page —
  // restoring its in-progress edit from autosave if present, else from the (now
  // up-to-date) snapshot, so switching objects never loses unsaved work.
  if (selected && editingPath !== selectedPath) {
    if (editingPath) {
      setObjects((prev) => mergeEditIntoObjects(prev, editingPath, edit.data, edit.body));
    }
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
        const devicePaths = await store.devicePaths(repoKey);
        if (cancelled) return;
        setDeviceOnlyPaths(devicePaths);
        const drafts = await store.allForRepo(repoKey);
        if (cancelled) return;

        // Drafts with no copy on the branch are reconstructed into the working model via the
        // same assembler the branch load uses (SPEC §5/§8): device-only objects (their sole
        // copy is local) and — the reload-safety case — a create/promote whose commit hadn't
        // landed yet. A non-device orphan is then re-queued so it reaches WIP; a device-only
        // one stays local. (An orphan already on the branch is skipped — the branch wins.)
        const orphanDrafts = drafts.filter((d) => !model.objects.some((o) => o.path === d.path));
        if (orphanDrafts.length > 0) {
          const snapshot = new Map(
            orphanDrafts.map((d) => [d.path, reassembleDocument(d.data, d.body)] as const),
          );
          const assembled = assembleContent(snapshot, model.schemas);
          if (assembled.objects.length > 0) {
            setObjects((prev) => {
              const have = new Set(prev.map((o) => o.path));
              return [...prev, ...assembled.objects.filter((o) => !have.has(o.path))];
            });
          }
          for (const d of orphanDrafts) {
            if (!devicePaths.has(d.path)) autosave.markObjectDirty(d.path, d.data, d.body);
          }
        }

        // Re-stage device-only bundles' persisted asset bytes into memory (SPEC §5/§8), so a
        // colocated image an on-device object references renders again after a reload — the
        // local counterpart to the branch AssetLoader that backed-up objects rely on.
        for (const asset of await store.allAssetsForRepo(repoKey)) {
          if (cancelled) return;
          assetStore.stage(asset.path, asset.blob);
        }

        // Recover backed-up drafts (already on the branch) as unsaved edits; autosave
        // re-commits them to WIP. Device-only and orphan drafts are handled above.
        for (const draft of drafts) {
          if (devicePaths.has(draft.path)) continue;
          const committed = model.objects.find((o) => o.path === draft.path);
          if (!committed) continue;
          const changed =
            reassembleDocument(draft.data, draft.body) !==
            reassembleDocument(committed.data, committed.body);
          if (changed) {
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
    // Device-only objects (SPEC §5/§8) persist to IndexedDB only — never queued to WIP.
    if (!deviceOnlyPaths.has(selectedPath)) {
      autosave.markObjectDirty(selectedPath, next.data, next.body);
    }
    void draftStore.current?.put(repoKey, selectedPath, next.data, next.body);
  }

  // A colocated image was staged for the selected object. For a device-only object the
  // bytes must NOT go to the branch — persist the Blob to IndexedDB so it survives a
  // reload (re-staged on load); for a backed-up object it rides the WIP commit as usual.
  function onContentAssetStaged(path: string): void {
    if (deviceOnlyPaths.has(selectedPath)) {
      void persistDeviceAsset(path, path);
    } else {
      autosave.markAssetDirty(path);
    }
  }

  // Persist a staged asset's bytes locally (device-only bundles, SPEC §5/§8), optionally at
  // a different path (for rename). Reads bytes from the in-memory staged Blob.
  async function persistDeviceAsset(fromPath: string, toPath: string): Promise<void> {
    const blob = assetStore.blobFor(fromPath);
    if (!blob) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await draftStore.current?.putAsset(repoKey, toPath, bytes, blob.type);
  }

  function updateField(key: string, value: unknown): void {
    const data = { ...edit.data };
    if (value === undefined || value === '') delete data[key];
    else data[key] = value;
    applyEdit({ ...edit, data });
  }

  // Create a new draft object (SPEC §5): unique slug within its type, seeded front
  // matter, persisted to IndexedDB. The author picks its **storage level** at creation
  // (SPEC §5/§8): `backed-up` commits its index.md to WIP like any other edit; `device`
  // keeps it on this machine only (never queued to WIP), the tradeoff shown in the dialog.
  function createObject(schema: ContentTypeSchema, title: string, storage: StorageLevel): void {
    // On an i18n site a new collection object gets the default language (front matter +
    // lang-prefixed path); singletons and single-language sites get none (SPEC §5 → ML).
    const lang =
      siteI18n.enabled && schema.kind === 'collection' ? siteI18n.defaultLanguage : undefined;
    const taken = new Set(
      objects
        .filter((o) => o.type === schema.name && (!lang || o.lang === lang))
        .map((o) => o.slug),
    );
    const created = newObject(schema.name, title, schema, taken, lang);
    setObjects((prev) => [...prev, created]);
    setSelectedPath(created.path);
    void draftStore.current?.put(repoKey, created.path, created.data, created.body);
    if (storage === 'device') {
      setDeviceOnlyPaths((prev) => new Set(prev).add(created.path));
      void draftStore.current?.setStorage(repoKey, created.path, 'device');
    } else {
      autosave.markObjectDirty(created.path, created.data, created.body);
    }
    setShowNew(false);
  }

  // Add a translation of the selected object (SPEC §5 → Multilingual): duplicate it as a
  // draft in the target language (fresh id, shared translationKey, body + fields copied,
  // assets copied by blob-SHA re-add — the same primitive as restore, no source deletion),
  // then select it to translate in place. If the source had no translationKey yet, backfill
  // the freshly-minted one onto it (via its live edit buffer) so both sides of the group link.
  function addTranslation(targetLang: string): void {
    if (!selected) return;
    const liveSource: ContentObject = { ...selected, data: edit.data, body: edit.body };
    const taken = new Set(
      objects
        .filter((o) => o.type === selected.type && o.lang === targetLang)
        .map((o) => o.slug),
    );
    const { translation, translationKey, mintedKey } = newTranslation(
      liveSource,
      targetLang,
      taken,
    );

    // Copy colocated assets by re-adding each blob at the NEW path (from === to, no
    // deletion — the source keeps its assets).
    const oldDir = selected.path.replace(/\/index\.md$/, '');
    const newDir = translation.path.replace(/\/index\.md$/, '');
    const moves = session.treeEntries
      .filter(
        (e) => e.type === 'blob' && e.path.startsWith(`${oldDir}/`) && e.path !== selected.path,
      )
      .map((e) => {
        const to = `${newDir}/${e.path.slice(oldDir.length + 1)}`;
        return { from: to, to, sha: e.sha };
      });

    autosave.markObjectCreated(translation.path, translation.data, translation.body, moves);
    void draftStore.current?.put(repoKey, translation.path, translation.data, translation.body);

    // Backfill the shared key onto the source (in its live buffer, so the selection-change
    // fold carries it into `objects`, and mark it dirty so the link is committed too).
    if (mintedKey) {
      const srcData = { ...edit.data, translationKey };
      setEdit((e) => ({ ...e, data: srcData }));
      autosave.markObjectDirty(selected.path, srcData, edit.body);
      void draftStore.current?.put(repoKey, selected.path, srcData, edit.body);
    }

    setObjects((prev) => [...prev, translation]);
    setSelectedPath(translation.path);
    setShowAddTranslation(false);
  }

  // The translation coverage of the selected object: which languages exist in its group,
  // and which of the site's languages are still missing (the "Add translation" choices).
  const selectedTranslationKey = selected
    ? (typeof edit.data.translationKey === 'string' && edit.data.translationKey) ||
      selected.translationKey
    : undefined;
  const existingLanguages = useMemo(() => {
    if (!selected) return [];
    const langs = new Set<string>();
    if (selected.lang) langs.add(selected.lang);
    if (selectedTranslationKey) {
      for (const o of objects) {
        if (o.translationKey === selectedTranslationKey && o.lang) langs.add(o.lang);
      }
    }
    return [...langs];
  }, [selected, selectedTranslationKey, objects]);
  const missingLanguages = siteI18n.languages.filter((l) => !existingLanguages.includes(l));
  // "Add translation" applies to a language-bearing collection page with a language still
  // to fill (so single-language sites and lang-less objects never see it).
  const canAddTranslation =
    siteI18n.enabled && !!selected?.lang && missingLanguages.length > 0;

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
    // A device-only object (SPEC §5/§8) exists only in IndexedDB — there's nothing on the
    // branch to schedule for removal, and no published version to restore to, so it's
    // dropped immediately and locally (like discarding a never-saved page).
    if (deviceOnlyPaths.has(target.path)) {
      setObjects((prev) => prev.filter((o) => o.path !== target.path));
      setDeviceOnlyPaths((prev) => {
        const next = new Set(prev);
        next.delete(target.path);
        return next;
      });
      void draftStore.current?.delete(repoKey, target.path);
      void draftStore.current?.deleteStorage(repoKey, target.path);
      // Drop the bundle's locally-persisted images too — nothing on the host to schedule.
      const bundleDir = target.path.replace(/\/index\.md$/, '') + '/';
      for (const asset of assetStore.all()) {
        if (asset.path.startsWith(bundleDir)) void draftStore.current?.deleteAsset(repoKey, asset.path);
      }
      if (selectedPath === target.path) setSelectedPath('');
      setDeleteTarget(null);
      return;
    }
    const bundleFiles = [target.path, ...bundleAssetEntries(target).map((e) => e.path)];
    autosave.markPathsDeleted(bundleFiles);
    void draftStore.current?.delete(repoKey, target.path);
    setDeletedPaths((prev) => new Set(prev).add(target.path));
    setDeleteTarget(null);
  }

  // Promote a device-only object to **Backed up** (SPEC §5/§8): clear its device flag and
  // queue its current content to WIP, so autosave commits it like any edit. Uses the live
  // edit buffer for the selected object (its latest keystrokes), else the stored copy. The
  // debounced flush lands after this render, by when the autosaver's isDeviceOnly predicate
  // (read via a ref) already reflects the removal — so the commit filter lets it through.
  function confirmBackup(target: ContentObject): void {
    const path = target.path;
    const data = path === selectedPath ? edit.data : target.data;
    const body = path === selectedPath ? edit.body : target.body;
    setDeviceOnlyPaths((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    void draftStore.current?.setStorage(repoKey, path, 'backed-up');
    autosave.markObjectDirty(path, data, body);
    void draftStore.current?.put(repoKey, path, data, body);
    // Re-queue the bundle's colocated images (persisted locally while device-only) so they
    // ride the WIP commit now. Their IndexedDB copies are left as a safety net until the
    // object is confirmed on the branch — harmless if redundant.
    const bundleDir = path.replace(/\/index\.md$/, '') + '/';
    for (const asset of assetStore.all()) {
      if (asset.path.startsWith(bundleDir)) autosave.markAssetDirty(asset.path);
    }
    setBackupTarget(null);
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

    // A device-only object (SPEC §5/§8) was never published, so a rename needs no redirect
    // alias and no branch move — just swap the path locally and move its draft + storage
    // record. Repoint bundle-relative front-matter values as usual.
    if (deviceOnlyPaths.has(oldPath)) {
      const data: FrontMatter = {};
      for (const [k, v] of Object.entries(edit.data)) {
        data[k] =
          typeof v === 'string' && v.startsWith(`${oldDir}/`)
            ? `${newDir}/${v.slice(oldDir.length + 1)}`
            : v;
      }
      void draftStore.current?.delete(repoKey, oldPath);
      void draftStore.current?.put(repoKey, newPath, data, edit.body);
      void draftStore.current?.deleteStorage(repoKey, oldPath);
      void draftStore.current?.setStorage(repoKey, newPath, 'device');
      // Move the bundle's locally-persisted images to the new path (in memory + IndexedDB),
      // so the repointed field values still resolve.
      for (const asset of assetStore.all()) {
        if (!asset.path.startsWith(`${oldDir}/`)) continue;
        const movedPath = `${newDir}/${asset.path.slice(oldDir.length + 1)}`;
        assetStore.stage(movedPath, asset.blob);
        const oldAssetPath = asset.path;
        void persistDeviceAsset(movedPath, movedPath).then(() =>
          draftStore.current?.deleteAsset(repoKey, oldAssetPath),
        );
      }
      setDeviceOnlyPaths((prev) => {
        const next = new Set(prev);
        next.delete(oldPath);
        next.add(newPath);
        return next;
      });
      const renamed: ContentObject = { ...selected, slug: newSlug, path: newPath, data };
      setObjects((prev) => prev.map((o) => (o.path === oldPath ? renamed : o)));
      setEdit({ data: { ...data }, body: edit.body });
      setEditingPath(newPath);
      setSelectedPath(newPath);
      setShowRename(false);
      return;
    }

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
  // Objects kept On this device (SPEC §5/§8) — shown in the header, but not "pending
  // publish" (they're not on the host), so they don't feed `hasChanges`.
  const deviceCount = useMemo(
    () => objects.filter((o) => deviceOnlyPaths.has(o.path) && !deletedPaths.has(o.path)).length,
    [objects, deviceOnlyPaths, deletedPaths],
  );

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

  // The published (default-branch) `index.md` for the selected page, powering the body
  // editor's Diff tab. A 404 means the page is brand-new (not yet on main) → null, which
  // the diff renders as all-additions. Memoised per path so the tab's lazy fetch is
  // stable (it isn't re-issued on every keystroke).
  const selectedPathForDiff = selected?.path;
  const getPublishedText = useCallback(async (): Promise<string | null> => {
    if (!selectedPathForDiff) return null;
    try {
      return await session.client.readFile(selectedPathForDiff, session.defaultBranch);
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'status' in err &&
        (err as { status: unknown }).status === 404
      ) {
        return null;
      }
      throw err;
    }
  }, [selectedPathForDiff, session]);

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
      const latest = await session.client.deploy?.getLatestDeploy(session.defaultBranch);
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
      const latest = await session.client.deploy?.getLatestDeploy(session.defaultBranch);
      setDeploySince(latest?.createdAt);
      await session.client.deploy?.triggerDeploy(session.defaultBranch);
    } catch (err) {
      console.warn('[timber] deploy retry failed to dispatch', err);
      setPublishPhase('failed');
    }
  }

  // Toggle the selected object's Draft/Public flag (SPEC §5). Writes `public` to front
  // matter (an undeclared key the tolerant validator passes through) and mirrors the
  // SAME front matter onto the working object — its derived `public` flag included — so
  // the sidebar badge + publish validity gate update live. Both sides must move together:
  // if only the object's flag flipped, a reseed after autosave (which reads the object's
  // now-stale front matter) would silently revert the page to Draft.
  function toggleVisibility(): void {
    if (!selected) return;
    const next = !(edit.data.public === true);
    const data = withPublic(edit.data, next);
    applyEdit({ ...edit, data });
    setObjects((prev) =>
      prev.map((o) =>
        o.path === selected.path ? { ...o, data, public: resolvePublic(data) } : o,
      ),
    );
  }

  // Advanced/admin state (templates + config), lazily loaded on first visit. Its file
  // list renders in the shared sidebar and its editor/preview in the shared work area.
  const advanced = useAdvanced(session, autosave, advancedSeen);

  // Site assets (binary /assets files) for the asset manager: the committed set is read
  // straight from the loaded tree (no extra fetch); the manager overlays this session's
  // uploads/deletes locally. Templates + stylesheets feed the delete-reference guard.
  const initialAssets = useMemo(() => listSiteAssets(session.treeEntries), [session]);
  const assetSources = useMemo(
    () =>
      (advanced.files ?? [])
        .filter((f) => f.kind === 'template' || f.kind === 'style')
        .map((f) => ({ path: f.path, text: f.content })),
    [advanced.files],
  );

  // ---- Layout: banner + drawer sidebar + split/tab/off preview (SPEC §8) ----------
  const layout = useLayout();

  // The changed-item list for the header changes panel: every non-clean content object,
  // then every non-content changed path (templates/config, and any stray asset). A
  // content bundle's colocated assets roll up into their object rather than listing
  // separately. Each content/advanced row can jump to its item (where its Diff tab and
  // Revert live); the diff itself is fetched lazily when a row is expanded.
  const changeEntries: ChangeEntry[] = useMemo(() => {
    const entries: ChangeEntry[] = [];
    const bundlePrefixes: string[] = [];
    for (const o of objects) {
      const state = objectChangeState(
        o.path,
        autosave.editingPaths,
        savedPaths,
        deletedPaths,
      );
      if (state === 'clean') continue;
      bundlePrefixes.push(o.path.replace(/\/index\.md$/, '') + '/');
      entries.push({
        path: o.path,
        title: String(o.data.title ?? o.slug),
        kind: 'content',
        state,
        onOpen: () => {
          setView('content');
          setSelectedPath(o.path);
          if (layout.isMobile) layout.setSidebarOpen(false);
        },
      });
    }
    for (const path of savedPaths) {
      if (bundlePrefixes.some((p) => path.startsWith(p))) continue; // rolled into its object
      const k = kindOf(path);
      entries.push({
        path,
        title: path.split('/').pop() ?? path,
        kind: k ?? 'asset',
        state: 'saved',
        onOpen:
          k && advancedAllowed
            ? () => {
                setAdvancedSeen(true);
                setView('advanced');
                advanced.setSelectedPath(path);
                if (layout.isMobile) layout.setSidebarOpen(false);
              }
            : undefined,
      });
    }
    return entries;
  }, [
    objects,
    autosave.editingPaths,
    savedPaths,
    deletedPaths,
    advanced,
    advancedAllowed,
    layout,
  ]);
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
  const previewEnabled = previewLive && (showPreviewPane || previewWindowOpenRef.current);
  // The edited site's own templates + theme, so preview ≡ the built page (SPEC §6/§13).
  const siteTheme = useSiteTheme(session, previewEnabled, activeTheme);
  const { html: previewHtml, error: previewError } = useRenderedPreview(
    workingModel,
    selected,
    schema,
    edit.data,
    edit.body,
    siteTheme,
    assetStore,
    previewEnabled,
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
      assetsActive ? (
        <AssetManager
          initialAssets={initialAssets}
          assetStore={assetStore}
          sources={assetSources}
          onStage={(path) => {
            autosave.markAssetDirty(path);
            autosave.saveNow();
          }}
          onDelete={(paths) => {
            autosave.markPathsDeleted(paths);
            autosave.saveNow();
          }}
        />
      ) : advanced.loadError ? (
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
          <AdvancedEditorPanel
            session={session}
            file={advanced.selected}
            value={advanced.value}
            validation={advanced.validation}
            onChange={advanced.onEdit}
            onRevert={advanced.revert}
          />
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
            {deviceOnlyPaths.has(selected.path) ? (
              <button
                type="button"
                className="editor-header__backup"
                onClick={() => setBackupTarget(selected)}
                title="Back up to the repo — commit this on-device page so it's durable and synced across your devices."
              >
                ☁ Back up to the repo
              </button>
            ) : null}
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
            <HeaderActions
              mobile={layout.isMobile}
              canDiscard={canDiscard}
              isCollection={selected.kind === 'collection'}
              canAddTranslation={canAddTranslation}
              onDiscard={() => setDiscardTarget(selected)}
              onAddTranslation={() => setShowAddTranslation(true)}
              onRename={() => setShowRename(true)}
              onDelete={() => setDeleteTarget(selected)}
            />
          </div>
        </header>

        <LocationReadout
          readout={computeLocationReadout({
            storage: deviceOnlyPaths.has(selected.path) ? 'device' : 'backed-up',
            hasLocalEdits: autosave.editingPaths.has(selected.path),
            differsFromMain: savedPaths.has(selected.path),
            newToMain: addedIndexPaths.has(selected.path),
            isPublic: edit.data.public === true,
            canDeploy,
          })}
          visibility={repoVisibility}
        />

        <section className="editor-panel">
          <h3>Fields</h3>
          <SchemaForm
            schema={schema}
            data={edit.data}
            model={workingModel}
            assetStore={assetStore}
            bundleDir={selected.path.replace(/\/index\.md$/, '')}
            onAssetStaged={onContentAssetStaged}
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
              assetStore={assetStore}
              bundleDir={selected.path.replace(/\/index\.md$/, '')}
              onStaged={onContentAssetStaged}
              diffWorkingText={reassembleDocument(edit.data, edit.body)}
              getPublishedText={getPublishedText}
              onRevert={canDiscard ? () => setDiscardTarget(selected) : undefined}
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

  // The site's templates (bare-name keyed) for the advanced preview, so a template that
  // `{% layout %}`s or `{% render %}`s another resolves it while being edited (SPEC §6).
  // The selected file uses its live (uncommitted) text; the rest use their loaded content.
  const advancedTemplates = useMemo<TemplateMap>(() => {
    const map: TemplateMap = {};
    const bareName = (path: string): string =>
      path.replace(/^templates\//, '').replace(/\.liquid$/, '');
    for (const f of advanced.files ?? []) {
      if (f.kind === 'template') map[bareName(f.path)] = f.content;
    }
    if (advanced.selected?.kind === 'template') {
      map[bareName(advanced.selected.path)] = advanced.value;
    }
    return map;
  }, [advanced.files, advanced.selected, advanced.value]);

  const previewContent =
    view === 'advanced' ? (
      assetsActive ? null : advanced.selected ? (
        <AdvancedPreview
          session={session}
          kind={advanced.selected.kind}
          template={advanced.value}
          templates={advancedTemplates}
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
          <h1 className="app__brand">
            <Wordmark />
          </h1>
          <code className="app__repo app__repo--banner">{session.loadedRef}</code>
          <div className="changes-anchor">
            <ChangesSummary
              editing={counts.editing}
              saved={counts.saved}
              deleting={counts.deleting}
              device={deviceCount}
              syncState={autosave.syncState}
              onSaveNow={autosave.saveNow}
              onToggle={
                hasChanges
                  ? () => {
                      setShowChanges((open) => {
                        // Flush pending edits to WIP on open so the panel diffs reflect
                        // everything (uncommitted edits otherwise wouldn't show).
                        if (!open) autosave.saveNow();
                        return !open;
                      });
                    }
                  : undefined
              }
              expanded={showChanges}
            />
            {showChanges ? (
              <ChangesPanel
                entries={changeEntries}
                client={session.client}
                baseRef={session.defaultBranch}
                headRef={session.wipBranch}
                bustKey={String(saveSeq)}
                onClose={() => setShowChanges(false)}
              />
            ) : null}
          </div>
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
                    deviceOnlyPaths={deviceOnlyPaths}
                    onSelect={(path) => {
                      setSelectedPath(path);
                      if (layout.isMobile) layout.setSidebarOpen(false);
                    }}
                    languages={siteI18n.languages}
                    defaultLanguage={siteI18n.defaultLanguage}
                  />
                </nav>
              ) : (
                <nav>
                  <div className="object-list__head">
                    <span>Templates &amp; config</span>
                    <div className="object-list__actions">
                      <button
                        type="button"
                        className="object-list__new"
                        disabled={!advanced.files}
                        onClick={() => setShowNewFile(true)}
                      >
                        ＋ New file
                      </button>
                      <button
                        type="button"
                        className="object-list__new"
                        disabled={!advanced.files}
                        onClick={() => setShowNewType(true)}
                      >
                        ＋ New type
                      </button>
                      <button
                        type="button"
                        className="object-list__new"
                        onClick={() => setShowImportTheme(true)}
                      >
                        ↓ Import theme
                      </button>
                    </div>
                  </div>
                  {advanced.loadError ? (
                    <p className="object-list__empty">Couldn’t load files.</p>
                  ) : !advanced.files ? (
                    <p className="object-list__empty">Loading…</p>
                  ) : (
                    <AdvancedList
                      files={advanced.files}
                      selectedPath={assetsActive ? undefined : advanced.selectedPath}
                      onSelect={(path) => {
                        setAssetsActive(false);
                        advanced.setSelectedPath(path);
                        if (layout.isMobile) layout.setSidebarOpen(false);
                      }}
                    />
                  )}

                  <section className="object-group">
                    <div className="object-group__head">
                      <span className="object-group__name">Assets</span>
                    </div>
                    <ul className="object-list">
                      <li>
                        <button
                          type="button"
                          className={assetsActive ? 'is-active' : ''}
                          onClick={() => {
                            setAssetsActive(true);
                            if (layout.isMobile) layout.setSidebarOpen(false);
                          }}
                        >
                          <span className="object-list__title">Manage assets</span>
                          <span className="object-list__type">
                            fonts, logos, favicons in /assets
                          </span>
                        </button>
                      </li>
                    </ul>
                  </section>
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
          repoPublic={
            repoVisibility === 'public' ? true : repoVisibility === 'private' ? false : undefined
          }
        />
      ) : null}

      {backupTarget ? (
        <BackupDialog
          object={backupTarget}
          visibility={repoVisibility}
          onClose={() => setBackupTarget(null)}
          onConfirm={() => confirmBackup(backupTarget)}
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
          onCreate={(opts) => advanced.createType(opts)}
        />
      ) : null}

      {showNewFile ? (
        <NewFileDialog
          existingPaths={new Set((advanced.files ?? []).map((f) => f.path))}
          onClose={() => setShowNewFile(false)}
          onCreate={(opts) => advanced.createFile(opts)}
        />
      ) : null}

      {showImportTheme ? (
        <ImportThemeDialog session={session} onClose={() => setShowImportTheme(false)} />
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

      {showAddTranslation && selected ? (
        <AddTranslationDialog
          object={selected}
          missingLanguages={missingLanguages}
          existingLanguages={existingLanguages}
          onClose={() => setShowAddTranslation(false)}
          onAdd={addTranslation}
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
