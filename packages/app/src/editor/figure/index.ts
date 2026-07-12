export { figureRemark } from './remark.js';
export {
  figureSchema,
  FIGURE_LAYOUTS,
  FIGURE_SIZES,
  DEFAULT_LAYOUT,
  DEFAULT_SIZE,
  normalizeLayout,
  normalizeSize,
  type FigureLayout,
  type FigureSize,
} from './schema.js';
export { insertFigureCommand, type InsertFigurePayload } from './commands.js';
export { figureView, type NodeViewFactory } from './view.js';
export { AssetUrlProvider, useAssetUrl } from './assetUrl.js';
export { FigureView } from './FigureView.js';
