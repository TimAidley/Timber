import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import postcss from 'postcss';

/**
 * Build-time check that the active theme actually styles the `:::figure` classes the
 * generator emits (SPEC §7 → Images). The generator deliberately emits *only* classes —
 * "the theme owns the actual pixels/floats via CSS" — which leaves a seam nothing else
 * watches: a theme whose `.fig` rules never reach the figure produces a page that looks
 * broken while every validator passes. Framed like the whole-repo orphan/broken-image
 * detection SPEC already puts at build level, not in the per-object validator.
 *
 * Why this needs real selector matching rather than a text search of the CSS: the case
 * that motivated it had the rules present *and* correct, scoped to `.post__content`,
 * while the page's template wrapped the body in `.page`. `.post__content .fig--wrap-right`
 * mentions the class, so any substring check passes; it simply never matches the element.
 * So we parse the CSS for real selectors, then ask the rendered page whether any of them
 * reaches this figure.
 *
 * Advisory only — a figure that lost its float is a page that looks wrong, not a broken
 * site, so it rides the same non-fatal `warnings` channel as the navigation problems and
 * must never fail an otherwise fine build. Every judgement call below therefore errs
 * towards silence: a warning that cries wolf is one nobody reads.
 */

/**
 * Layout classes that do nothing without theme CSS, so an unstyled one is a real defect.
 * `full-width` is deliberately absent: it is the default and column-width by definition,
 * so a theme that never mentions it is behaving correctly, not missing a rule.
 */
const LAYOUTS_NEEDING_CSS = ['wrap-left', 'wrap-right', 'center'];
const SIZES = ['sm', 'md', 'lg'];
const FULL_WIDTH = 'fig--full-width';

/** A page worth checking: its URL (for the message) and the HTML that was written. */
export interface RenderedPage {
  url: string;
  /** Output directory of the page, relative to the site root (`urlToDir` output). */
  dir: string;
  html: string;
}

/**
 * Every selector in `css`, or `null` if it doesn't parse. `null` (rather than an empty
 * list) matters: no selectors would make every class look unreachable and warn about a
 * whole site, so the caller skips instead.
 */
function selectorsIn(css: string): string[] | null {
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return null;
  }
  const selectors: string[] = [];
  root.walkRules((rule) => {
    // `@keyframes` steps (`from`, `0%`) are selector-shaped but address no element.
    const parent = rule.parent;
    if (parent?.type === 'atrule' && /keyframes$/i.test((parent as postcss.AtRule).name))
      return;
    selectors.push(...rule.selectors);
  });
  return selectors;
}

/**
 * The classes on `figure` that the theme is expected to style. Size only counts off the
 * default layout: SPEC §7 says size "sets the rendered width bucket for `wrap-*`/`center`
 * and is **ignored for `full-width`**", so an unstyled `fig--sm` on a full-width figure
 * is not a defect.
 */
function classesNeedingCss(figure: Element): string[] {
  const needed: string[] = [];
  const layout = LAYOUTS_NEEDING_CSS.find((name) =>
    figure.classList.contains(`fig--${name}`),
  );
  if (layout) needed.push(`fig--${layout}`);
  if (!figure.classList.contains(FULL_WIDTH)) {
    const size = SIZES.find((name) => figure.classList.contains(`fig--${name}`));
    if (size) needed.push(`fig--${size}`);
  }
  return needed;
}

/**
 * Drop pseudo-elements and state pseudo-classes, which never match in a static document
 * and would otherwise read as "unstyled": a theme whose `.fig--wrap-right::before` or
 * `:hover` rule exists has plainly targeted the class here, which is all this check asks.
 * Structural pseudo-classes (`:not`, `:is`, `:nth-child`…) are deliberately left alone —
 * they do match, and honouring them is the point.
 */
function withoutStateAndPseudoElements(selector: string): string {
  return selector
    .replace(/::[\w-]+(\([^)]*\))?/g, '')
    .replace(
      /:(hover|focus|focus-within|focus-visible|active|visited|link|target)\b/g,
      '',
    )
    .trim();
}

/**
 * How a class fares against the theme's CSS. The distinction is the difference between a
 * near-certain bug and a note:
 *
 * - `scoped-out` — rules keyed on the class exist but none reach this figure. Somebody
 *   wrote the styling and it is silently not applying; that is a mismatch between a
 *   template and a stylesheet, and the case this check was built for.
 * - `absent` — no rule mentions the class anywhere. The theme simply doesn't implement
 *   that option, so the figure falls back to the theme's generic `.fig` styling, which
 *   may well look fine (a theme centring in its base rule needs no `fig--center`). Worth
 *   saying, not worth alarm.
 */
type Reachability = 'reached' | 'scoped-out' | 'absent';

/**
 * Whether any rule *keyed on* `className` reaches `figure`. Both halves are load-bearing:
 * a selector must name the class (a generic `.post__content figure` rule styles the
 * element but implements none of the layout the class asks for) **and** must actually
 * select this element in this document (which is the half that catches a scoping
 * mismatch). Media conditions are ignored on purpose — anatole floats `wrap-*` only above
 * 961px by design, and that is a styled class, not a missing rule.
 */
function reachability(
  document: Document,
  figure: Element,
  className: string,
  selectors: string[],
): Reachability {
  // `(?![\w-])` so `.fig--sm` isn't satisfied by a theme's unrelated `.fig--small`.
  const mentionsClass = new RegExp(`\\.${className}(?![\\w-])`);
  const candidates = selectors.filter((selector) => mentionsClass.test(selector));
  if (candidates.length === 0) return 'absent';
  for (const selector of candidates) {
    const target = withoutStateAndPseudoElements(selector);
    if (target === '') continue;
    let matched: NodeListOf<Element>;
    try {
      matched = document.querySelectorAll(target);
    } catch {
      // A selector this matcher can't evaluate (an unresolved nesting `&`, say). We can't
      // prove it misses, so assume it reaches and stay quiet.
      return 'reached';
    }
    for (const element of matched) if (element === figure) return 'reached';
  }
  return 'scoped-out';
}

/**
 * Parse a page without jsdom narrating what it couldn't understand.
 *
 * jsdom parses every `<style>` it meets as it builds the document, and its CSS parser
 * predates cascade layers — so a page carrying the embed stylesheet (SPEC §7 → Embeds,
 * which wraps its baseline in `@layer` precisely so a theme can override it) made every
 * build print "Could not parse CSS stylesheet", twice, with the whole sheet after it.
 * Nothing was wrong: the page ships that CSS to browsers, which do understand `@layer`.
 *
 * Silence is also what this check already promises for CSS it can't read — "unparseable
 * CSS yields silence rather than a guess" — it just had no way to keep that promise for
 * a sheet jsdom chokes on while parsing the document itself. A sheet that fails to parse
 * contributes no selectors, so the rules in it are treated as absent, which is the
 * conservative direction: this check only ever warns about figure classes, and an
 * unparsed sheet can only make it warn less.
 */
function parsePage(html: string): Document {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  return new JSDOM(html, { virtualConsole }).window.document;
}

/** A figure class this page asks for that the theme's CSS doesn't deliver. */
export interface FigureCssFinding {
  className: string;
  status: Exclude<Reachability, 'reached'>;
}

/**
 * The figure classes on `html` that `css` doesn't style. Pure (strings in, findings out)
 * so the interesting cases are unit-testable without a site on disk.
 */
export function findUnstyledFigureClasses(html: string, css: string): FigureCssFinding[] {
  const selectors = selectorsIn(css);
  if (selectors === null) return [];

  const document = parsePage(html);
  // `scoped-out` wins over `absent` for the same class: if any figure on the page has
  // styling written for it that fails to land, that's the finding worth reporting.
  const worst = new Map<string, Exclude<Reachability, 'reached'>>();
  for (const figure of document.querySelectorAll('figure.fig')) {
    for (const className of classesNeedingCss(figure)) {
      const status = reachability(document, figure, className, selectors);
      if (status === 'reached') continue;
      if (status === 'scoped-out' || !worst.has(className)) worst.set(className, status);
    }
  }
  return [...worst]
    .map(([className, status]) => ({ className, status }))
    .sort((a, b) => a.className.localeCompare(b.className));
}

/**
 * The CSS a page actually loads: every same-site `<link rel="stylesheet">` plus any inline
 * `<style>`. Returns `null` when a stylesheet can't be read — an external one, or a path
 * that doesn't resolve — because a missing sheet could be the very one carrying the rules,
 * and guessing there would invent warnings.
 */
async function cssForPage(
  outDir: string,
  basePath: string,
  page: RenderedPage,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const document = parsePage(page.html);
  const parts: string[] = [];

  for (const link of document.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const href = link.getAttribute('href')!.split(/[?#]/)[0]!;
    if (href === '' || /^[a-z]+:/i.test(href) || href.startsWith('//')) return null;

    // Site-root-absolute hrefs carry `site.basePath` (a project-Pages subpath); strip it
    // to get back to a path under the output directory. Relative hrefs resolve against
    // the page's own directory, as the browser would.
    let rel: string;
    if (href.startsWith('/')) {
      const rooted = href.slice(1);
      const prefix = basePath.replace(/^\//, '');
      if (prefix && !(rooted === prefix || rooted.startsWith(`${prefix}/`))) return null;
      rel = prefix ? rooted.slice(prefix.length).replace(/^\//, '') : rooted;
    } else {
      rel = posix.normalize(posix.join(page.dir, href));
      if (rel.startsWith('..')) return null;
    }

    if (!cache.has(rel)) {
      cache.set(
        rel,
        await readFile(join(outDir, ...rel.split('/')), 'utf8').catch(() => null),
      );
    }
    const css = cache.get(rel)!;
    if (css === null) return null;
    parts.push(css);
  }

  for (const style of document.querySelectorAll('style'))
    parts.push(style.textContent ?? '');
  return parts.join('\n');
}

/**
 * Check every rendered page that contains a figure, and describe what the theme leaves
 * unstyled. Messages name the likely cause, because the symptom ("my image is the wrong
 * size") is a long way from the fix (a template and a stylesheet disagreeing about a
 * wrapper class).
 */
export async function figureStyleWarnings(
  outDir: string,
  basePath: string,
  pages: RenderedPage[],
): Promise<string[]> {
  const cache = new Map<string, string | null>();
  const warnings: string[] = [];
  for (const page of pages) {
    const css = await cssForPage(outDir, basePath, page, cache);
    if (css === null) continue;
    const findings = findUnstyledFigureClasses(page.html, css);

    const scopedOut = names(findings, 'scoped-out');
    if (scopedOut) {
      warnings.push(
        `${page.url}: the theme styles ${scopedOut}, but none of those rules reach this ` +
          `page's figures, so the layout is silently lost. The usual cause is the theme ` +
          `scoping its .fig rules to a wrapper class this page's template doesn't use.`,
      );
    }

    const absent = names(findings, 'absent');
    if (absent) {
      warnings.push(
        `${page.url}: the active theme has no rule for ${absent}, so those figures fall ` +
          `back to its generic .fig styling and the choice has no effect here.`,
      );
    }
  }
  return warnings;
}

/** The quoted class names of one status, or `undefined` if none — for the messages above. */
function names(
  findings: FigureCssFinding[],
  status: FigureCssFinding['status'],
): string | undefined {
  const matching = findings
    .filter((f) => f.status === status)
    .map((f) => `"${f.className}"`);
  return matching.length > 0 ? matching.join(', ') : undefined;
}
