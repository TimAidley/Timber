import { DiffView } from './DiffView.js';
import { useRefText, type RefTextClient } from './useRefText.js';

interface PathDiffProps {
  client: RefTextClient;
  /** Repo-relative path to diff. */
  path: string;
  /** The "old" ref (published side) — usually the default branch. */
  baseRef: string;
  /** The "new" ref (changed side) — usually the WIP branch. */
  headRef: string;
  /** Refetch when this changes (e.g. after a save advances the WIP tip). */
  bustKey?: string | undefined;
}

/**
 * Diff one repo path between two refs by fetching both blobs (base and head) and
 * feeding {@link DiffView}. Used where the changed text lives on a branch rather
 * than in memory — the Publish dialog and the header changes panel. A missing
 * blob on either side (404 → null) renders as an all-added / all-removed file.
 */
export function PathDiff({ client, path, baseRef, headRef, bustKey }: PathDiffProps): React.JSX.Element {
  const base = useRefText(client, path, baseRef, true, bustKey);
  const head = useRefText(client, path, headRef, true, bustKey);
  return (
    <DiffView
      base={base.text}
      working={head.text ?? ''}
      loading={base.loading || head.loading}
      error={base.error ?? head.error}
    />
  );
}
