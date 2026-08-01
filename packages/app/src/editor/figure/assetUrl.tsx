import { createContext, useContext, useEffect, useState } from 'react';
import type { AssetStore } from '../../state/assets.js';
import { bodySrcToRepoPath } from '../../media/assetName.js';

/**
 * What a figure NodeView needs to display an image: the {@link AssetStore} holding the
 * bytes, and the **bundle directory** of the object being edited. The ProseMirror adapter
 * renders NodeViews inside the editor's React tree, so context reaches them.
 *
 * The bundle directory is required because a body's `src` is relative to the page
 * (`images/p.webp`), while the store keys on repo paths
 * (`content/posts/hello/images/p.webp`) — only the object being edited says which bundle
 * turns one into the other.
 */
export interface AssetContext {
  store: AssetStore;
  bundleDir: string;
}

const AssetStoreContext = createContext<AssetContext | null>(null);

export const AssetStoreProvider = AssetStoreContext.Provider;

/**
 * Resolve a body's image `src` to a displayable URL. Staged (just-uploaded) images
 * resolve synchronously; a committed image not in memory (e.g. after a reload, before
 * publish) is lazily fetched via the store's loader, and the component re-renders when it
 * arrives. Returns `undefined` while loading or when the asset can't be found.
 *
 * Takes the `src` as written in the body — page-relative — and maps it to the repo path
 * the store keys on. Passing the raw `src` straight to the store is why a hand-authored
 * or imported image showed "Image not available in the editor" while rendering correctly
 * on the site.
 */
export function useResolvedAssetUrl(src: string): string | undefined {
  const ctx = useContext(AssetStoreContext);
  const store = ctx?.store;
  const path = ctx && src ? bodySrcToRepoPath(ctx.bundleDir, src) : undefined;
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
