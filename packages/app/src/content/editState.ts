import { resolvePublic, type ContentObject } from '@timber/content';
import type { FrontMatter } from '@timber/generator';

/**
 * Fold a page's live edit buffer back into the working-object snapshot (SPEC §5/§8).
 *
 * While a page is selected the editor keeps its in-progress front matter + body in a
 * separate `edit` buffer; `objects` holds the coarser snapshot the sidebar, id index,
 * and selection-reseed read from. When you switch pages the outgoing buffer has to be
 * merged back into its object — otherwise, once autosave has committed and dropped the
 * object's dirty entry, returning to the page reseeds from its stale load-time data and
 * silently reverts your edits (they stay safe on the WIP branch, but the editor shows
 * the old copy until a reload). The derived `public` flag is recomputed from the merged
 * front matter so it can never drift from `data.public` (the Draft/Public invariant).
 *
 * Returns the array unchanged (same reference) when `path` isn't present — so navigating
 * away from a just-deleted object doesn't needlessly churn the working model.
 */
export function mergeEditIntoObjects(
  objects: ContentObject[],
  path: string,
  data: FrontMatter,
  body: string,
): ContentObject[] {
  let changed = false;
  const next = objects.map((o) => {
    if (o.path !== path) return o;
    changed = true;
    return { ...o, data, body, public: resolvePublic(data) };
  });
  return changed ? next : objects;
}
