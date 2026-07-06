import { useCallback, useEffect, useState } from 'react';

/**
 * Editor layout state (SPEC §8): a persistent top banner, a collapsible drawer
 * sidebar, and a preview that can be side-by-side (draggable), tabbed, or hidden.
 *
 * These are per-device *UI preferences*, not content or secrets, so `localStorage`
 * is the right home — the SPEC's "keep it out of localStorage" rule is about tokens,
 * not layout. Defaults are viewport-derived (mobile hides the sidebar and tabs the
 * preview) but only until the user expresses a preference, which then wins.
 */
export type PreviewMode = 'split' | 'tab' | 'off';
export type PreviewTab = 'edit' | 'preview';

/** Below this width the editor switches to its mobile defaults (drawer + tabs). */
export const MOBILE_QUERY = '(max-width: 900px)';
/** Clamp bounds for the draggable split so neither pane can be crushed away. */
export const MIN_PREVIEW_WIDTH = 280;
export const MIN_MAIN_WIDTH = 360;
const DEFAULT_PREVIEW_WIDTH = 420;

const LS = {
  sidebar: 'timber:layout:sidebar',
  previewMode: 'timber:layout:previewMode',
  previewWidth: 'timber:layout:previewWidth',
} as const;

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — layout just won't persist */
  }
}

function matchesMobile(): boolean {
  try {
    return window.matchMedia(MOBILE_QUERY).matches;
  } catch {
    return false;
  }
}

export interface Layout {
  isMobile: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  previewMode: PreviewMode;
  setPreviewMode: (mode: PreviewMode) => void;
  previewTab: PreviewTab;
  setPreviewTab: (tab: PreviewTab) => void;
  previewWidth: number;
  /** `persist=false` during a live drag; persist once on drop to avoid LS churn. */
  setPreviewWidth: (width: number, persist?: boolean) => void;
}

export function useLayout(): Layout {
  const [isMobile, setIsMobile] = useState(matchesMobile);

  useEffect(() => {
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(MOBILE_QUERY);
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent): void => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const [sidebarOpen, setSidebarOpenState] = useState<boolean>(() => {
    const stored = readLS(LS.sidebar);
    if (stored === 'open') return true;
    if (stored === 'closed') return false;
    return !matchesMobile(); // no stored pref → open on desktop, hidden on mobile
  });
  const setSidebarOpen = useCallback((open: boolean) => {
    setSidebarOpenState(open);
    writeLS(LS.sidebar, open ? 'open' : 'closed');
  }, []);
  const toggleSidebar = useCallback(() => {
    setSidebarOpenState((prev) => {
      const next = !prev;
      writeLS(LS.sidebar, next ? 'open' : 'closed');
      return next;
    });
  }, []);

  const [previewMode, setPreviewModeState] = useState<PreviewMode>(() => {
    const stored = readLS(LS.previewMode);
    if (stored === 'split' || stored === 'tab' || stored === 'off') return stored;
    return matchesMobile() ? 'tab' : 'split';
  });
  const setPreviewMode = useCallback((mode: PreviewMode) => {
    setPreviewModeState(mode);
    writeLS(LS.previewMode, mode);
  }, []);

  const [previewTab, setPreviewTab] = useState<PreviewTab>('edit');

  const [previewWidth, setPreviewWidthState] = useState<number>(() => {
    const stored = Number(readLS(LS.previewWidth));
    return Number.isFinite(stored) && stored >= MIN_PREVIEW_WIDTH
      ? stored
      : DEFAULT_PREVIEW_WIDTH;
  });
  const setPreviewWidth = useCallback((width: number, persist = true) => {
    setPreviewWidthState(width);
    if (persist) writeLS(LS.previewWidth, String(Math.round(width)));
  }, []);

  return {
    isMobile,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    previewMode,
    setPreviewMode,
    previewTab,
    setPreviewTab,
    previewWidth,
    setPreviewWidth,
  };
}
