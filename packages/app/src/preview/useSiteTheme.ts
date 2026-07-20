import { useEffect, useState } from 'react';
import { loadSiteTheme, type SiteTheme } from './siteTheme.js';
import type { RepoSession } from '../state/repoSession.js';

const EMPTY: SiteTheme = {
  templates: new Map(),
  stylesheets: new Map(),
  navigationYml: null,
  objectUrls: [],
};

/**
 * Load the edited site's templates + theme once per branch, for the live preview
 * (SPEC §6/§13). Gated by `enabled` so nothing is fetched until a preview surface is
 * actually shown; reloads if the session's branch changes, and revokes the theme's
 * object URLs when replaced or unmounted. On failure it yields an empty theme, so the
 * render falls back to surfacing "no template" rather than crashing the pane.
 */
export function useSiteTheme(
  session: RepoSession,
  enabled: boolean,
  activeTheme?: string,
): SiteTheme | null {
  const [state, setState] = useState<{
    ref: string;
    activeTheme: string | undefined;
    theme: SiteTheme;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (state?.ref === session.loadedRef && state.activeTheme === activeTheme) return;
    let cancelled = false;
    loadSiteTheme(session.client, session.loadedRef, activeTheme)
      .then((theme) => {
        if (!cancelled) setState({ ref: session.loadedRef, activeTheme, theme });
      })
      .catch(() => {
        if (!cancelled) setState({ ref: session.loadedRef, activeTheme, theme: EMPTY });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, session, activeTheme, state]);

  // Revoke a theme's object URLs when it's replaced or the editor unmounts.
  useEffect(
    () => () => state?.theme.objectUrls.forEach((u) => URL.revokeObjectURL(u)),
    [state],
  );

  return state?.theme ?? null;
}
