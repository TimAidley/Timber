import { useEffect, useState } from 'react';
import type { RefComparison } from '@timber/github';

/**
 * Whether the editor bundle is up to date with the Timber branch it follows (SPEC §12).
 *
 * - `unknown`  — no build provenance (dev build), or the check hasn't/ couldn't run: hide the banner.
 * - `checking` — the comparison is in flight.
 * - `current`  — the followed ref hasn't moved past our build.
 * - `outdated` — the followed ref is ahead of our build; a redeploy would ship a newer editor.
 */
export type UpdateState = 'unknown' | 'checking' | 'current' | 'outdated';

export interface UpdateStatus {
  state: UpdateState;
  /** When `outdated`, how many commits the followed ref is ahead of our build. */
  behindBy?: number;
}

/**
 * Interpret a `base(built SHA)...head(followed ref)` comparison. `aheadBy` counts the
 * commits the followed ref has that our build doesn't, so any positive value means the
 * build is behind. Pure, so it's unit-tested without React or the network.
 */
export function interpretComparison(cmp: RefComparison): UpdateStatus {
  return cmp.aheadBy > 0
    ? { state: 'outdated', behindBy: cmp.aheadBy }
    : { state: 'current' };
}

interface CompareClient {
  compareRefs(base: string, head: string): Promise<RefComparison>;
}

/**
 * Check once, on mount, whether the Timber build the editor is running has fallen behind
 * the branch it follows. `builtSha` is the commit this bundle was built from and `ref` is
 * the branch/tag it tracks (both baked in at build time, see `github/buildInfo`); `client`
 * is bound to the **upstream Timber repo**, not the site repo.
 *
 * Deliberately best-effort: any error (the upstream repo unreadable with this token, a
 * network blip) leaves the state at `unknown`, so a failed check never blocks editing or
 * shows a misleading banner. Skipped entirely when `enabled` is false (missing provenance).
 */
export function useUpstreamVersion(
  client: CompareClient | undefined,
  ref: string | undefined,
  builtSha: string | undefined,
  enabled: boolean,
): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'unknown' });

  useEffect(() => {
    if (!enabled || !client || !ref || !builtSha) {
      setStatus({ state: 'unknown' });
      return;
    }
    let cancelled = false;
    setStatus({ state: 'checking' });
    void (async () => {
      try {
        const cmp = await client.compareRefs(builtSha, ref);
        if (!cancelled) setStatus(interpretComparison(cmp));
      } catch {
        if (!cancelled) setStatus({ state: 'unknown' }); // best-effort: stay silent on error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, ref, builtSha, enabled]);

  return status;
}
