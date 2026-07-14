import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepoSession } from '../state/repoSession.js';
import type { Autosave } from '../state/autosave.js';
import { LocalDraftStore } from '../state/localDraft.js';
import { repoConfig } from '../github/config.js';
import { loadAdvancedFiles, type AdvancedFile } from './loadAdvancedFiles.js';
import { validateAdvancedFile, type AdvancedValidation } from './validate.js';
import { buildSchemaYaml, schemaPathFor, type NewTypeOptions } from './schemaTemplate.js';
import { buildStarterFile, newFilePath, type NewFileOptions } from './newFile.js';
import { reconcileAdvancedDrafts, KIND_ORDER } from './reconcileDrafts.js';

export interface Advanced {
  files: AdvancedFile[] | null;
  loadError: string | null;
  selectedPath: string;
  setSelectedPath: (path: string) => void;
  selected: AdvancedFile | undefined;
  value: string;
  validation: AdvancedValidation | undefined;
  onEdit: (next: string) => void;
  /** Create a new content type's schema file and open it for editing (SPEC §8). */
  createType: (opts: NewTypeOptions) => void;
  /** Create a new template (`.liquid`) or config (`.yml`) file and open it (SPEC §8). */
  createFile: (opts: NewFileOptions) => void;
  /**
   * Revert a template/config file to its published version (SPEC §8), the advanced-area
   * counterpart to a page's Discard. A file added on WIP (e.g. a new type) is removed
   * entirely. Resolves once the branch (and local state) are reconciled.
   */
  revert: (path: string) => Promise<void>;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status: unknown }).status === 404
  );
}

/**
 * State for the advanced/admin area (SPEC §8): load `templates/*.liquid` + `config/**`
 * (which live outside the content snapshot), reconcile any locally-saved drafts, and
 * validate every edit with the *same* machinery the build uses — an **invalid** file
 * is never committed but its draft is kept in IndexedDB so nothing is lost.
 *
 * Lifted out of the old self-contained `AdvancedArea` component so the file list can
 * render in the shared editor sidebar (alongside the content object list) while the
 * code editor + preview render in the shared work area. `active` gates the (network)
 * load so nothing is fetched until the user first opens the advanced view.
 */
export function useAdvanced(
  session: RepoSession,
  autosave: Autosave,
  active: boolean,
): Advanced {
  const [files, setFiles] = useState<AdvancedFile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>('');
  // The working text per file (draft/dirty/committed), keyed by path.
  const [text, setText] = useState<Map<string, string>>(new Map());

  const repoKey = `${repoConfig.owner}/${repoConfig.repo}`;
  const draftStore = useRef<LocalDraftStore | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!active || loaded.current) return;
    loaded.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const store = await LocalDraftStore.open();
        const loadedFiles = await loadAdvancedFiles(session.client, session.loadedRef);
        if (cancelled) return;
        draftStore.current = store;
        const drafts = await store.allForRepo(repoKey);
        const { files, text, requeue } = reconcileAdvancedDrafts(loadedFiles, drafts);
        // Re-queue any uncommitted valid drafts (in-progress edits + resurrected files).
        for (const { path, content } of requeue) autosave.markFileDirty(path, content);
        if (cancelled) return;
        setFiles(files);
        setText(text);
        setSelectedPath((prev) => prev || files[0]?.path || '');
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Load once, when first activated. repoKey/autosave are session-stable.
  }, [active, session]);

  const selected = files?.find((f) => f.path === selectedPath);
  const value = selected ? (text.get(selected.path) ?? selected.content) : '';

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

  /**
   * Author a new content type (SPEC §8): generate a starter `config/schemas/<name>.yml`
   * from the dialog's options and commit it like any other advanced file (see `addFile`).
   * Because the content model is built at load time, the new type becomes available for
   * authoring on the next reload — the dialog nudges that, the same as every schema change.
   */
  function createType(opts: NewTypeOptions): void {
    addFile({
      path: schemaPathFor(opts.name),
      kind: 'schema',
      content: buildSchemaYaml(opts),
    });
  }

  /**
   * Author a new **template** or **config** file (SPEC §8). The advanced area edits the
   * site's `templates/*.liquid` and `config/*.yml` directly, but "New type" only covered
   * schemas — a site owner customizing the theme also needs to *add* a template (e.g.
   * `templates/events.liquid` to style one content type) or a plain config file. Same
   * flow as `createType`: generate valid starter content, add it to the list, select it,
   * and commit it through the shared WIP autosaver. Unlike a schema, a template/config
   * file changes nothing in the content model, so no editor reload is needed — it takes
   * effect in the live preview and the next build straight away.
   */
  function createFile(opts: NewFileOptions): void {
    addFile({
      path: newFilePath(opts),
      kind: opts.kind,
      content: buildStarterFile(opts),
    });
  }

  /**
   * Shared create path for every new advanced file (schema/template/config): add the
   * file to the list (sorted, a duplicate path a no-op guard — dialogs already block
   * existing names), select it, persist a local draft, and — flushing immediately so it
   * reaches the branch promptly — commit it through the shared WIP autosaver. The
   * generated starter is always valid, so it flows straight into the coalesced commit;
   * if a reload beats the commit, draft-recovery re-surfaces the file, so nothing is lost.
   */
  function addFile(file: AdvancedFile): void {
    const { path, content } = file;
    setFiles((prev) => {
      const base = prev ?? [];
      if (base.some((f) => f.path === path)) return base;
      return [...base, file].sort(
        (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.path.localeCompare(b.path),
      );
    });
    setText((prev) => new Map(prev).set(path, content));
    setSelectedPath(path);
    void draftStore.current?.put(repoKey, path, {}, content);
    if (validateAdvancedFile(file).valid) {
      autosave.markFileDirty(path, content);
      autosave.saveNow();
    }
  }

  /**
   * Revert one advanced file to its published (default-branch) version. Mirrors the
   * content Discard flow (Editor.discardChanges): drop pending local state, then — only
   * if the file is actually committed on WIP — commit the reset through the shared
   * autosaver (so the header counts refresh via the normal saved-state signal). A file
   * that's brand-new on WIP has no published version and is removed outright.
   */
  async function revert(path: string): Promise<void> {
    const file = files?.find((f) => f.path === path);
    if (!file) return;

    let published: string | null;
    try {
      published = await session.client.readFile(path, session.defaultBranch);
    } catch (err) {
      if (isNotFound(err)) published = null;
      else throw err;
    }

    // Is the file committed on WIP (needs a branch commit to reset), or only edited
    // locally (drop the pending edit and we're done)?
    let onWip = false;
    try {
      const changed = await session.client.compareChangedPaths(
        session.defaultBranch,
        session.wipBranch,
      );
      onWip = changed.some((c) => c.path === path);
    } catch {
      onWip = false; // no WIP branch yet → nothing committed
    }

    if (published === null) {
      // Added on WIP (e.g. a just-created type) → remove it entirely.
      if (onWip) {
        autosave.markPathsDeleted([path]);
        autosave.saveNow();
      } else {
        autosave.forgetFile(path);
      }
      void draftStore.current?.delete(repoKey, path);
      setFiles((prev) => (prev ?? []).filter((f) => f.path !== path));
      setText((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });
      setSelectedPath((prev) =>
        prev === path ? (files?.find((f) => f.path !== path)?.path ?? '') : prev,
      );
      return;
    }

    // Reset to the published version. Committing the (known-valid) published text back
    // to WIP yields main's blob, so the path drops out of the main…WIP diff.
    if (onWip) {
      autosave.markFileDirty(path, published);
      autosave.saveNow();
    } else {
      autosave.forgetFile(path);
    }
    void draftStore.current?.delete(repoKey, path);
    setText((prev) => new Map(prev).set(path, published));
  }

  return {
    files,
    loadError,
    selectedPath,
    setSelectedPath,
    selected,
    value,
    validation,
    onEdit,
    createType,
    createFile,
    revert,
  };
}
