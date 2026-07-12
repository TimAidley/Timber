import type { AssetLoader } from './assets.js';
import type { RepoSession } from './repoSession.js';
import { mimeForPath } from '../media/assetName.js';

/**
 * An {@link AssetLoader} backed by the session's loaded branch: it looks a path up in
 * the tree (path → blob SHA) and fetches the committed bytes. This is what lets an image
 * inserted in an earlier session re-display after a reload — the bytes are on the WIP
 * branch (autosave committed them) but no longer in memory. Unknown paths (never
 * committed) resolve to `undefined`, so the NodeView shows its placeholder rather than
 * a broken image.
 */
export function repoAssetLoader(session: RepoSession): AssetLoader {
  const shaByPath = new Map(
    session.treeEntries.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]),
  );
  return async (path) => {
    const sha = shaByPath.get(path);
    if (!sha) return undefined;
    const bytes = await session.client.readBinaryBlob(sha);
    return new Blob([bytes], { type: mimeForPath(path) });
  };
}
