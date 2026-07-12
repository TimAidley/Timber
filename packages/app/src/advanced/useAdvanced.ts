import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepoSession } from '../state/repoSession.js';
import type { Autosave } from '../state/autosave.js';
import { LocalDraftStore } from '../state/localDraft.js';
import { repoConfig } from '../github/config.js';
import { loadAdvancedFiles, type AdvancedFile } from './loadAdvancedFiles.js';
import { validateAdvancedFile, type AdvancedValidation } from './validate.js';
import { buildSchemaYaml, schemaPathFor, type NewTypeOptions } from './schemaTemplate.js';
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
   * from the dialog's options, add it to the file list, select it, and commit it like
   * any other advanced edit. The generated schema is always valid, so it flows straight
   * into the shared WIP commit; the new type becomes available for content on reload
   * (same as every schema/config change). A duplicate path is a no-op guard — the dialog
   * already blocks existing names.
   *
   * We flush the commit immediately (`saveNow`) rather than waiting out the autosave
   * debounce, so the schema reaches the branch promptly — the type is then usable after
   * the next reload with the smallest possible window. (If a reload still beats the
   * commit, the draft-recovery above re-surfaces the file, so nothing is lost.)
   */
  function createType(opts: NewTypeOptions): void {
    const path = schemaPathFor(opts.name);
    const content = buildSchemaYaml(opts);
    const file: AdvancedFile = { path, kind: 'schema', content };
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
  };
}
