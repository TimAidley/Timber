import { useEffect, useState } from 'react';
import { loadSiteTheme, type SiteTheme } from './siteTheme.js';
import type { RepoSession } from '../state/repoSession.js';

const EMPTY: SiteTheme = { templates: new Map(), css: '', navigationYml: null, objectUrls: [] };

/**
 * Load the edited site's templates + theme once per branch, for the live preview
 * (SPEC §6/§13). Gated by `enabled` so nothing is fetched until a preview surface is
 * actually shown; reloads if the session's branch changes, and revokes the theme's
 * object URLs when replaced or unmounted. On failure it yields an empty theme, so the
 * render falls back to surfacing "no template" rather than crashing the pane.
 */
export function useSiteTheme(session: RepoSession, enabled: boolean): SiteTheme | null {
  const [state, setState] = useState<{ ref: string; theme: SiteTheme } | null>(null);

  useEffect(() => {
    if (!enabled || state?.ref === session.loadedRef) return;
    let cancelled = false;
    loadSiteTheme(session.client, session.loadedRef)
      .then((theme) => {
        if (!cancelled) setState({ ref: session.loadedRef, theme });
      })
      .catch(() => {
        if (!cancelled) setState({ ref: session.loadedRef, theme: EMPTY });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, session, state]);

  // Revoke a theme's object URLs when it's replaced or the editor unmounts.
  useEffect(
    () => () => state?.theme.objectUrls.forEach((u) => URL.revokeObjectURL(u)),
    [state],
  );

  return state?.theme ?? null;
}
