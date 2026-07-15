import type { TemplateMap } from '@timber/generator';

/**
 * Convert the preview's filename-keyed template map (`default.liquid` → source, as
 * `siteTheme` loads it) into the **bare-name** map LiquidJS resolves `{% layout %}` /
 * `{% render %}` / `{% include %}` against (`default` → source) — SPEC §6 layout
 * inheritance + snippets. Non-`.liquid` keys (if any) are passed through unchanged.
 *
 * An optional `override` swaps one entry's source (keyed by *bare* name) — used by the
 * advanced-area preview so a template being edited previews with its live, uncommitted
 * text even when another template `{% layout %}`s it.
 */
export function bareNameTemplates(
  byFilename: ReadonlyMap<string, string>,
  override?: { name: string; source: string },
): TemplateMap {
  const map: TemplateMap = {};
  for (const [filename, source] of byFilename) {
    map[filename.replace(/\.liquid$/, '')] = source;
  }
  if (override) map[override.name] = override.source;
  return map;
}
