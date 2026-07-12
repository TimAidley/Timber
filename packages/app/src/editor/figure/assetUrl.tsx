import { createContext, useContext } from 'react';

/**
 * Resolves a repo-relative asset path to a URL the browser can actually load. Staged
 * (just-uploaded) images live in the {@link ../../state/assets.AssetStore} as object
 * URLs; the figure NodeView needs that mapping to show the image while editing, since
 * the bundle path itself isn't a real URL until the site is built and deployed.
 *
 * Provided by {@link ../BodyEditor.BodyEditor} and read by
 * {@link FigureView} — which the ProseMirror adapter renders inside the same React
 * tree, so context reaches it. Returns the path unchanged when nothing is staged.
 */
const AssetUrlContext = createContext<(path: string) => string>((path) => path);

export const AssetUrlProvider = AssetUrlContext.Provider;

export function useAssetUrl(): (path: string) => string {
  return useContext(AssetUrlContext);
}
