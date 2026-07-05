import { useEffect } from 'react';

/**
 * Neutralize browser **back-navigation** while the editor is open.
 *
 * A stray Backspace (Vivaldi and old Firefox map a bare Backspace to "Back") — or an
 * accidental Back button / swipe — would otherwise leave the `/admin/` page and throw
 * away in-progress edits. We keep one dummy history entry ahead of the editor and
 * re-push it whenever the user pops it, so "Back" becomes a no-op that keeps you in the
 * editor. Normal in-editor deletion is untouched (see backspaceFix); this only cancels
 * the *navigation*. Leaving the editor deliberately (a link, typing a URL, closing the
 * tab) still works.
 */
export function useBackNavigationGuard(): void {
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const onPopState = (): void => {
      window.history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
