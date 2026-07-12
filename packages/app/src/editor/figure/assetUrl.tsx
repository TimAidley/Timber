import { createContext, useContext, useEffect, useState } from 'react';
import type { AssetStore } from '../../state/assets.js';

/**
 * Provides the {@link AssetStore} to figure NodeViews. The ProseMirror adapter renders
 * them inside the editor's React tree, so context reaches them. Held as the store (not a
 * bare resolver) so components can also trigger the store's lazy load of committed bytes.
 */
const AssetStoreContext = createContext<AssetStore | null>(null);

export const AssetStoreProvider = AssetStoreContext.Provider;

/**
 * Resolve a repo-relative asset path to a displayable URL. Staged (just-uploaded) images
 * resolve synchronously; a committed image not in memory (e.g. after a reload, before
 * publish) is lazily fetched via the store's loader, and the component re-renders when it
 * arrives. Returns `undefined` while loading or when the asset can't be found.
 */
export function useResolvedAssetUrl(path: string): string | undefined {
  const store = useContext(AssetStoreContext);
  const [url, setUrl] = useState<string | undefined>(() =>
    store && path ? store.urlFor(path) : undefined,
  );

  useEffect(() => {
    if (!store || !path) {
      setUrl(undefined);
      return;
    }
    const staged = store.urlFor(path);
    if (staged) {
      setUrl(staged);
      return;
    }
    let active = true;
    void store.ensure(path).then((resolved) => {
      if (active) setUrl(resolved);
    });
    return () => {
      active = false;
    };
  }, [store, path]);

  return url;
}
