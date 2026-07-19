// THROWAWAY SPIKE — the mechanical "import a Jekyll template" transform.
//
// This is the compatibility strategy the audit landed on: don't run Jekyll templates
// byte-for-byte, *import* them through a small deterministic converter that rewrites the
// handful of structural idioms where Jekyll and Timber's LiquidJS differ. It operates on
// the REAL Minima source (read from the theme clone) — nothing here is hand-authored
// lookalike markup, so it genuinely tests "can real theme templates be mechanically
// carried over." The three rewrites:
//
//   1. Layout chaining — Jekyll's front-matter `layout: base` + implicit `{{ content }}`
//      injection → LiquidJS block inheritance `{% layout 'base' %}{% block main %}…%}`.
//   2. Include syntax — `{% include head.html %}` → `{% include 'head' %}`, and
//      `{% include nav.html paths = x %}` → `{% include 'nav', paths: x %}`. LiquidJS's
//      `{% include %}` already shares parent scope (like Jekyll's), so no scope shim is
//      needed — the audit's key uncertainty, resolved in our favour.
//   3. `include.foo` → `foo` — Jekyll namespaces passed params under `include.*`; LiquidJS
//      exposes them as bare locals. Timber has no `include` object, so this is safe.

/** Split leading `---\n…\n---` front matter; return { layout, body }. */
function splitFrontMatter(source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return { layout: undefined, body: source };
  const layoutMatch = /^layout:\s*(.+)\s*$/m.exec(m[1]);
  const layout = layoutMatch ? layoutMatch[1].trim().replace(/['"]/g, '') : undefined;
  return { layout, body: source.slice(m[0].length) };
}

/** Strip a `.html`/`.liquid` extension from an include target → bare template-map name. */
function bareName(file) {
  return file.replace(/\.(html|liquid)$/i, '');
}

/** `paths = page_paths` (Jekyll) → `, paths: page_paths` (LiquidJS include hash). */
function convertIncludeArgs(args) {
  const pairs = [];
  const re = /([\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g;
  let m;
  while ((m = re.exec(args)) !== null) pairs.push(`${m[1]}: ${m[2]}`);
  return pairs.length ? `, ${pairs.join(', ')}` : '';
}

/** Rewrite every `{% include file.html k=v %}` to LiquidJS `{% include 'file', k: v %}`. */
function convertIncludes(body) {
  return body.replace(
    /\{%(-?)\s*include\s+([\w./-]+)((?:[^%]|%(?!\}))*?)(-?)%\}/g,
    (_all, lt, file, args, rt) =>
      `{%${lt} include '${bareName(file)}'${convertIncludeArgs(args)} ${rt}%}`,
  );
}

/**
 * Import one Jekyll template into Timber-compatible Liquid.
 *
 * @param {string} source  Raw Jekyll template (with any front matter).
 * @param {{ asParentLayout?: boolean }} [opts]
 *   `asParentLayout: true` marks the root layout (Minima's `base`): its `{{ content }}`
 *   slot becomes the `{% block main %}` children override. A child layout instead declares
 *   `{% layout %}` and wraps its own body in that block.
 */
export function importJekyllTemplate(source, opts = {}) {
  const { layout, body: raw } = splitFrontMatter(source);
  // (2) + (3): include syntax and the include.* namespace, applied to every template.
  let body = convertIncludes(raw).replace(/\binclude\./g, '');

  // (4) Escaping reconciliation. Jekyll's Liquid does NOT auto-escape output, so themes
  // escape explicitly with `| escape`. Timber's engine auto-escapes every `{{ output }}`
  // by default (SPEC §6), so those explicit calls would DOUBLE-escape (`&` → `&amp;amp;`).
  // A Jekyll-compat layer must reconcile the two contracts; the two clean options are
  // (a) disable Timber's auto-escape in compat mode (Jekyll-faithful), or (b) drop the now-
  // redundant explicit HTML-escape filters on import. The spike takes (b) — Timber still
  // escapes, so output stays safe; it's just no longer escaped twice.
  body = body.replace(/\s*\|\s*escape(_once)?\b/g, '');

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
