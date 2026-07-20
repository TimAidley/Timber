import type { TemplateMap } from '@timber/generator';

/**
 * The mechanical "import an Eleventy (Liquid) template" transform (SPEC §2 → Tier A). Like the
 * Jekyll transform, an Eleventy theme is *imported* through this deterministic converter rather
 * than executed by Eleventy. Eleventy Liquid is already LiquidJS, so the rewrites are small and
 * structural — the differences from Jekyll are the folder/reference conventions, not the
 * language:
 *
 *   1. Layout chaining — front-matter `layout: layouts/base.liquid` + `{{ content }}` injection
 *      → LiquidJS block inheritance (`{% layout 'layouts/base' %}{% block main %}…`). The
 *      layout reference keeps its subpath but loses its file extension.
 *   2. Include targets — `{% include "css/reset.liquid" %}` → `{% include "css/reset" %}`
 *      (strip the extension so it resolves against the in-memory template map). A *bare*
 *      (unquoted) include target is a variable (Eleventy `dynamicPartials`), so it's left alone.
 *   3. Un-spaced tags — nulite and other real themes ship `{%if x%}` / `{%for … %}`, which
 *      LiquidJS rejects; a space is inserted after the delimiter.
 *
 * Data access (`{{ title }}`, `{{ site.* }}` from `_data`) is handled at RENDER time by the
 * generator's data cascade (`flattenData` + `globals`), not here — see `eleventyEngine`.
 */

export interface ImportOptions {
  /** True for the theme's **root** layout: its `{{ content }}` slot becomes `{% block main %}`. */
  asRoot?: boolean;
}

const stripExt = (s: string): string => s.replace(/\.(liquid|html|njk)$/i, '');

/** Split leading front matter; return the (extension-stripped) `layout` ref + the body. */
function splitFrontMatter(source: string): { layout: string | undefined; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return { layout: undefined, body: source };
  const lm = /^layout:\s*(.+?)\s*$/m.exec(m[1]!);
  const layout = lm ? stripExt(lm[1]!.trim().replace(/['"]/g, '')) : undefined;
  return { layout, body: source.slice(m[0].length) };
}

/** Strip the file extension from a **quoted** `{% include/render "x.liquid" %}` target. A bare
 *  (unquoted) target is a variable under Eleventy's `dynamicPartials`, so it's left untouched. */
function normalizeIncludes(body: string): string {
  return body.replace(
    /(\{%-?\s*(?:include|render)\s+(['"])[\w./-]+?)\.(?:liquid|html|njk)(\2)/g,
    '$1$3',
  );
}

/** `{%if x%}` → `{% if x %}` — a space after the delimiter for tags real themes ship un-spaced. */
function normalizeTags(body: string): string {
  return body.replace(
    /\{%(-?)(if|for|unless|assign|capture|case|tablerow|else|elsif|when|endif|endfor|endunless|endcase|endcapture|endtablerow)\b/g,
    (_all, lt: string, tag: string) => `{%${lt} ${tag}`,
  );
}

/** Import one Eleventy Liquid template into a Timber-compatible template (see the three rewrites). */
export function importEleventyTemplate(source: string, opts: ImportOptions = {}): string {
  const { layout, body: raw } = splitFrontMatter(source);
  let body = normalizeTags(normalizeIncludes(raw));
  if (layout) {
    // Child: its whole body becomes the `main` block of the named parent layout.
    return `{% layout '${layout}' %}\n{% block main %}\n${body}\n{% endblock %}\n`;
  }
  if (opts.asRoot) {
    body = body.replace(/\{\{-?\s*content\s*-?\}\}/g, '{% block main %}{% endblock %}');
  }
  return body;
}

/**
 * Import a whole set of Eleventy theme templates (bare name → source, e.g. `layouts/default`,
 * `navbar`, `css/global`) into a Timber {@link TemplateMap}. `rootLayout` names the base layout
 * others chain to; it gets the `{{ content }}` → `{% block main %}` treatment.
 */
export function importEleventyTheme(
  files: Record<string, string>,
  rootLayout: string,
): TemplateMap {
  const templates: TemplateMap = {};
  for (const [name, source] of Object.entries(files)) {
    templates[name] = importEleventyTemplate(source, { asRoot: name === rootLayout });
  }
  return templates;
}
