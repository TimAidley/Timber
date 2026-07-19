import { parseFrontMatter, type TemplateMap } from '@timber/generator';

/**
 * The mechanical "import a Jekyll template" transform. Rather than run Jekyll templates
 * unmodified, a Jekyll theme is *imported* through this deterministic converter, which
 * rewrites the handful of structural idioms where Jekyll's Liquid and Timber's LiquidJS
 * differ. The rewrites:
 *
 *   1. Layout chaining — Jekyll's front-matter `layout: base` + implicit `{{ content }}`
 *      injection → LiquidJS block inheritance (`{% layout 'base' %}{% block main %}…`).
 *   2. Include syntax — `{% include head.html %}` → `{% include 'head' %}`, and
 *      `{% include nav.html paths = x %}` → `{% include 'nav', paths: x %}`. LiquidJS's
 *      `{% include %}` already shares parent scope (like Jekyll's), so no scope shim is
 *      needed.
 *   3. `include.foo` → `foo` — Jekyll namespaces passed params under `include.*`; LiquidJS
 *      exposes them as bare locals. Timber has no `include` object, so this is safe.
 *   4. Escaping reconciliation — Jekyll's Liquid does NOT auto-escape, so themes escape
 *      explicitly with `| escape`. Timber's engine auto-escapes every output (SPEC §6, an
 *      XSS-safety default), so those explicit calls would double-escape. We drop the now-
 *      redundant `| escape` / `| escape_once`; Timber still escapes, so output stays safe —
 *      it's just no longer escaped twice. (We keep auto-escape ON rather than disable it,
 *      because disabling Timber's safe default for imported themes would reintroduce the
 *      injection risk §6 removes.)
 */

export interface ImportOptions {
  /**
   * True for the theme's **root** layout (e.g. Minima's `base`): its `{{ content }}` slot
   * becomes the overridable `{% block main %}`. A child layout instead declares
   * `{% layout %}` and wraps its own body in that block.
   */
  asParentLayout?: boolean;
}

/** Split leading `---\n…\n---` front matter; return the declared `layout` (if any) + body. */
function splitFrontMatter(source: string): { layout: string | undefined; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return { layout: undefined, body: source };
  const layoutMatch = /^layout:\s*(.+?)\s*$/m.exec(m[1]!);
  const layout = layoutMatch ? layoutMatch[1]!.trim().replace(/['"]/g, '') : undefined;
  return { layout, body: source.slice(m[0].length) };
}

/** Strip a `.html`/`.liquid` extension from an include target → bare template-map name. */
function bareName(file: string): string {
  return file.replace(/\.(html|liquid)$/i, '');
}

/** `paths = page_paths` (Jekyll) → `, paths: page_paths` (LiquidJS include hash). */
function convertIncludeArgs(args: string): string {
  const pairs: string[] = [];
  const re = /([\w-]+)\s*=\s*("[^"]*"|'[^']*'|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args)) !== null) pairs.push(`${m[1]}: ${m[2]}`);
  return pairs.length ? `, ${pairs.join(', ')}` : '';
}

/**
 * Rewrite Jekyll includes to LiquidJS includes, classifying the target:
 *   - `{% include head.html %}`            → `{% include 'head' %}`     (file → quoted literal)
 *   - `{% include nav.html paths = x %}`   → `{% include 'nav', paths: x %}`
 *   - `{% include {{ file }} %}`           → `{% include file %}`       (dynamic name → variable)
 *   - `{% include somevar %}`              → `{% include somevar %}`    (bare identifier → variable)
 * The file-vs-variable distinction is the extension (`.html`/`.liquid`) or a path slash —
 * Jekyll static includes always name a file, so an extension-less bare token is a variable.
 */
function convertIncludes(body: string): string {
  return body.replace(
    /\{%(-?)\s*include\s+(\{\{[\s\S]*?\}\}|[\w./-]+)((?:[^%]|%(?!\}))*?)(-?)%\}/g,
    (_all, lt: string, target: string, args: string, rt: string) => {
      const t = target.trim();
      let ref: string;
      if (t.startsWith('{{')) {
        ref = t.replace(/^\{\{\s*|\s*\}\}$/g, ''); // dynamic name → bare variable
      } else if (/\.(html|liquid)$/i.test(t) || t.includes('/')) {
        ref = `'${bareName(t)}'`; // a file → quoted literal
      } else {
        ref = t; // a bare identifier → variable
      }
      return `{%${lt} include ${ref}${convertIncludeArgs(args)} ${rt}%}`;
    },
  );
}

/** Import one Jekyll template into Timber-compatible Liquid (see the four rewrites above). */
export function importJekyllTemplate(source: string, opts: ImportOptions = {}): string {
  const { layout, body: raw } = splitFrontMatter(source);
  // (2) + (3): include syntax and the include.* namespace, on every template.
  let body = convertIncludes(raw).replace(/\binclude\./g, '');
  // (4): drop now-redundant explicit entity-escaping filters (Timber auto-escapes). Covers
  // `escape`, `escape_once`, and `xml_escape` — all entity-escape like Timber's default, so
  // in an HTML template each would double-escape. (`xml_escape` in a genuine feed.xml is a
  // non-issue: Timber defers RSS, so those files aren't rendered here.)
  body = body.replace(/\s*\|\s*(escape|escape_once|xml_escape)\b/g, '');

  if (layout) {
    // (1) child: its whole body becomes the `main` block of the named parent layout.
    return `{% layout '${layout}' %}\n{% block main %}\n${body}\n{% endblock %}\n`;
  }
  if (opts.asParentLayout) {
    // (1) parent: the `{{ content }}` slot becomes the overridable block.
    body = body.replace(/\{\{-?\s*content\s*-?\}\}/g, '{% block main %}{% endblock %}');
  }
  return body;
}

/** The result of importing a whole Jekyll theme. */
export interface ImportedTheme {
  /** Bare name → Timber-compatible Liquid, ready to hand to `renderPage` as `templates`. */
  templates: TemplateMap;
  /**
   * Per-layout front-matter data (minus the `layout:` key) — the analogue of Jekyll's
   * `layout.*`. A theme whose root layout stashes asset lists in its front matter reads them
   * back via `layout.common-css` etc.; pass `layoutData[rootLayout]` to `renderPage`'s
   * `layout` option so those resolve. Only templates that HAD data appear here.
   */
  layoutData: Record<string, Record<string, unknown>>;
}

/**
 * Import a whole set of Jekyll theme templates (bare name → source) into a Timber
 * {@link TemplateMap} + per-layout data. `rootLayout` names the theme's base layout (the one
 * others chain to via front-matter `layout:`), which gets the parent-layout `{{ content }}` →
 * `{% block main %}` treatment; everything else is imported as a child layout or a plain
 * include. Each template's front matter (beyond `layout:`) is collected into `layoutData`.
 */
export function importJekyllTheme(
  files: Record<string, string>,
  rootLayout: string,
): ImportedTheme {
  const templates: TemplateMap = {};
  const layoutData: Record<string, Record<string, unknown>> = {};
  for (const [name, source] of Object.entries(files)) {
    templates[name] = importJekyllTemplate(source, {
      asParentLayout: name === rootLayout,
    });
    const data = { ...parseFrontMatter(source).data };
    delete data.layout; // the chaining directive, not data
    if (Object.keys(data).length > 0) layoutData[name] = data;
  }
  return { templates, layoutData };
}
