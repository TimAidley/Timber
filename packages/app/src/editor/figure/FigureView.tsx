import { useNodeViewContext } from '@prosemirror-adapter/react';
import {
  FIGURE_LAYOUTS,
  FIGURE_SIZES,
  normalizeLayout,
  normalizeSize,
  type FigureLayout,
  type FigureSize,
} from './schema.js';
import { useResolvedAssetUrl } from './assetUrl.js';

const LAYOUT_LABEL: Record<FigureLayout, string> = {
  'full-width': 'Full width',
  'wrap-left': 'Wrap left',
  'wrap-right': 'Wrap right',
  center: 'Centered',
};

const SIZE_LABEL: Record<FigureSize, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The live figure NodeView (SPEC §7/§8). Draws the image from the node's attrs, an
 * editable `<figcaption>` (the content hole, via `contentRef`), and an inline control
 * strip to pick layout + size — each button writes the choice straight to the node's
 * attributes, so the WYSIWYG mirrors what the build will produce. `size` is disabled
 * for full-width, where it has no effect.
 *
 * The component takes no props: the ProseMirror adapter renders it inside the editor's
 * React tree, so it reads node state from `useNodeViewContext` and the staged-asset URL
 * resolver from context.
 */
export function FigureView(): React.JSX.Element {
  const { node, contentRef, setAttrs, selected } = useNodeViewContext();

  const layout = normalizeLayout(node.attrs.layout);
  const size = normalizeSize(node.attrs.size);
  const src = asString(node.attrs.src);
  const alt = asString(node.attrs.alt);
  const url = useResolvedAssetUrl(src);

  const patch = (attrs: { layout?: FigureLayout; size?: FigureSize }): void => {
    setAttrs({ ...node.attrs, ...attrs });
  };

  return (
    <figure
      className={`fig fig--${layout} fig--${size} figure-node${selected ? ' is-selected' : ''}`}
      data-layout={layout}
      data-size={size}
    >
      <div className="figure-node__bar" contentEditable={false}>
        <div className="figure-node__group" role="group" aria-label="Image layout">
          {FIGURE_LAYOUTS.map((option) => (
            <button
              key={option}
              type="button"
              className={layout === option ? 'is-active' : ''}
              aria-pressed={layout === option}
              title={LAYOUT_LABEL[option]}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => patch({ layout: option })}
            >
              {LAYOUT_LABEL[option]}
            </button>
          ))}
        </div>
        <div className="figure-node__group" role="group" aria-label="Image size">
          {FIGURE_SIZES.map((option) => (
            <button
              key={option}
              type="button"
              className={size === option ? 'is-active' : ''}
              aria-pressed={size === option}
              disabled={layout === 'full-width'}
              title={
                layout === 'full-width'
                  ? 'Size applies to wrapped or centered images'
                  : SIZE_LABEL[option]
              }
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => patch({ size: option })}
            >
              {option.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {url ? (
        <img src={url} alt={alt} draggable={false} />
      ) : (
        <div className="figure-node__missing" contentEditable={false}>
          Image not available in the editor
        </div>
      )}

      <figcaption ref={contentRef} data-placeholder="Add a caption…" />
    </figure>
  );
}
