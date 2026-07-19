import type { Liquid } from 'liquidjs';
import { registerJekyllFilters } from './filters.js';
import { registerJekyllTags } from './tags.js';

/**
 * Register the whole Jekyll compatibility surface (ecosystem filters + tags) on a LiquidJS
 * engine. Pass this as the `extend` hook to `@timber/generator`'s `renderPage` /
 * `createEngine`, so an imported Jekyll theme renders through the same engine as everything
 * else:
 *
 *   renderPage({ ...input, templates, extend: registerJekyllCompat })
 *
 * The generator core stays unaware of Jekyll; this is the only wiring point.
 */
export function registerJekyllCompat(engine: Liquid): void {
  registerJekyllFilters(engine);
  registerJekyllTags(engine);
}
