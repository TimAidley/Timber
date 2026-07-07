import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepoSession } from '../state/repoSession.js';
import type { Autosave } from '../state/autosave.js';
import { LocalDraftStore } from '../state/localDraft.js';
import { repoConfig } from '../github/config.js';
import { loadAdvancedFiles, type AdvancedFile } from './loadAdvancedFiles.js';
import { validateAdvancedFile, type AdvancedValidation } from './validate.js';

export interface Advanced {
  files: AdvancedFile[] | null;
  loadError: string | null;
  selectedPath: string;
  setSelectedPath: (path: string) => void;
  selected: AdvancedFile | undefined;
  value: string;
  validation: AdvancedValidation | undefined;
  onEdit: (next: string) => void;
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
        const files = await loadAdvancedFiles(session.client, session.loadedRef);
        if (cancelled) return;
        draftStore.current = store;
        const working = new Map(files.map((f) => [f.path, f.content]));
        for (const draft of await store.allForRepo(repoKey)) {
          if (working.has(draft.path) && draft.body !== working.get(draft.path)) {
            working.set(draft.path, draft.body);
            // A restored draft may be an as-yet-uncommitted valid edit; re-queue it.
            const file = files.find((f) => f.path === draft.path)!;
            if (validateAdvancedFile({ ...file, content: draft.body }).valid) {
              autosave.markFileDirty(draft.path, draft.body);
            }
          }
        }
        if (cancelled) return;
        setFiles(files);
        setText(working);
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

  return {
    files,
    loadError,
    selectedPath,
    setSelectedPath,
    selected,
    value,
    validation,
    onEdit,
  };
}
