import { useEffect, useState } from 'react';

/** The one RepoClient method the diff surfaces need; keeps this fakeable in tests. */
export interface RefTextClient {
  readFile(path: string, ref: string): Promise<string>;
}

export interface RefTextState {
  /** The file's text at the ref, or null if it doesn't exist there (added/removed). */
  text: string | null;
  loading: boolean;
  error: string | null;
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status: unknown }).status === 404;
}

/**
 * Fetch one file's text at a git ref for diffing, resolving a **404 to `null`**
 * (the file simply doesn't exist on that side — a brand-new or deleted path — which
 * the diff renders as all-additions / all-deletions rather than an error). Refetches
 * whenever the path, ref, or `bustKey` changes; pass a moving `bustKey` (e.g. the
 * branch tip SHA) so a diff refreshes after the underlying branch advances.
 */
export function useRefText(
  client: RefTextClient,
  path: string,
  ref: string,
  enabled: boolean,
  bustKey?: string,
): RefTextState {
  const [state, setState] = useState<RefTextState>({ text: null, loading: false, error: null });

  useEffect(() => {
    if (!enabled || !path) {
      setState({ text: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ text: null, loading: true, error: null });
    client
      .readFile(path, ref)
      .then((text) => {
        if (!cancelled) setState({ text, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isNotFound(err)) setState({ text: null, loading: false, error: null });
        else setState({ text: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [client, path, ref, enabled, bustKey]);

  return state;
}
