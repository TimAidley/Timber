import { $view } from '@milkdown/kit/utils';
import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import type { ReactNodeViewUserOptions } from '@prosemirror-adapter/react';
import { figureSchema } from './schema.js';
import { FigureView } from './FigureView.js';

/** Factory type from `@prosemirror-adapter/react`'s `useNodeViewFactory()`. */
export type NodeViewFactory = (options: ReactNodeViewUserOptions) => NodeViewConstructor;

/**
 * Bind the {@link FigureView} React component to the `figure` node. The adapter's
 * node-view factory is a React hook, so it can't live in a module singleton — the
 * editor calls `useNodeViewFactory()` and passes it here when composing plugins.
 */
export function figureView(nodeViewFactory: NodeViewFactory) {
  return $view(figureSchema.node, () => nodeViewFactory({ component: FigureView }));
}
