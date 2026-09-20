import { describe, expect, it } from 'vitest';
import { findUnstyledFigureClasses } from '../src/figureCss.node.js';

/** Just the class names, for the cases where the status isn't what's under test. */
const unstyled = (html: string, css: string): string[] =>
  findUnstyledFigureClasses(html, css).map((f) => f.className);

/**
 * The build-time check that a theme really styles the `:::figure` classes the generator
 * emits (SPEC §7 → Images). Most of these cases are about *not* warning: the check is
 * advisory, so a false positive costs more than a miss.
 */

/** A figure as the generator writes it, inside whatever wrapper a template chose. */
function page(
  wrapperClass: string,
  figureClasses = 'fig fig--wrap-right fig--sm',
): string {
  return `<!doctype html><html><head><link rel="stylesheet" href="/assets/theme.css"></head>
    <body><main><div class="${wrapperClass}">
      <figure class="${figureClasses}"><img src="a.webp" alt="A"></figure>
    </div></main></body></html>`;
}

const FIG_CSS = `
  .fig--wrap-right { float: right; }
  .fig--sm { width: 12rem; }
`;

describe('findUnstyledFigureClasses', () => {
  it('stays quiet when the theme styles the emitted classes', () => {
    expect(unstyled(page('page'), FIG_CSS)).toEqual([]);
  });

  it('reports the layout and size when the theme has no figure rules at all', () => {
    expect(unstyled(page('page'), '.site-header { color: red; }')).toEqual([
      'fig--sm',
      'fig--wrap-right',
    ]);
  });

  /**
   * The regression this check exists for. The rules are present *and correct* — anatole
   * scopes them to `.post__content`, which is right for the templates that use it — but
   * the projects template wrapped the body in `.page`, so they reached nothing. Any
   * substring search of the CSS passes here, which is why matching has to be real.
   */
  it('catches rules that mention the class but are scoped out of reach', () => {
    const css = `
      .post__content .fig--wrap-right { float: right; max-width: 50%; }
      .post__content .fig--sm { max-width: 50%; }
    `;
    expect(unstyled(page('post__content'), css)).toEqual([]);
    expect(unstyled(page('page'), css)).toEqual(['fig--sm', 'fig--wrap-right']);
  });

  it('counts a rule inside a media query as styled', () => {
    // anatole floats wrap-* only above 961px on purpose — a deliberate breakpoint is a
    // styled class, not a missing rule, so the condition is ignored.
    const css = `@media screen and (min-width: 961px) {
      .fig--wrap-right { float: right; }
      .fig--sm { max-width: 50%; }
    }`;
    expect(unstyled(page('page'), css)).toEqual([]);
  });

  it('never asks a theme to style full-width, which needs no CSS', () => {
    const html = page('page', 'fig fig--full-width fig--md');
    expect(unstyled(html, '.site-header { color: red; }')).toEqual([]);
  });

  it('ignores an unstyled size on a full-width figure, which ignores size anyway', () => {
    // SPEC §7: size "sets the rendered width bucket for wrap-*/center and is ignored for
    // full-width".
    const html = page('page', 'fig fig--full-width fig--sm');
    expect(unstyled(html, '.fig--full-width { width: 100%; }')).toEqual([]);
  });

  it('is not satisfied by a rule that styles the figure without naming the class', () => {
    // `.page figure` reaches the element but implements none of the layout the class asks
    // for, so the float is still missing.
    expect(unstyled(page('page'), '.page figure { margin: 1rem 0; }')).toEqual([
      'fig--sm',
      'fig--wrap-right',
    ]);
  });

  it('does not accept a different class that merely shares a prefix', () => {
    const css = '.fig--small { width: 8rem; } .fig--wrap-right-ish { float: right; }';
    expect(unstyled(page('page'), css)).toEqual(['fig--sm', 'fig--wrap-right']);
  });

  it('stays quiet on CSS it cannot parse rather than warning about everything', () => {
    expect(unstyled(page('page'), '.fig--wrap-right { float: right;')).toEqual([]);
  });

  it('accepts a pseudo-element or state rule as evidence the class is targeted', () => {
    // Neither matches in a static document, but both show the theme has this class in
    // hand here — and the scoping check still applies to the rest of the selector.
    const css =
      '.fig--wrap-right::before { content: ""; } .fig--sm:hover { width: 12rem; }';
    expect(unstyled(page('page'), css)).toEqual([]);

    const scopedOut = '.post__content .fig--wrap-right::before { content: ""; }';
    expect(unstyled(page('page'), scopedOut)).toContain('fig--wrap-right');
  });

  it('ignores keyframe steps, which are selector-shaped but address no element', () => {
    const css = '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }' + FIG_CSS;
    expect(unstyled(page('page'), css)).toEqual([]);
  });

  it('has nothing to say about a page with no figures', () => {
    const html = '<!doctype html><html><body><p>No pictures here.</p></body></html>';
    expect(unstyled(html, '')).toEqual([]);
  });

  it('reports a class once however many figures share the problem', () => {
    const html = `<!doctype html><html><body><div class="page">
      <figure class="fig fig--wrap-right fig--sm"><img src="a.webp" alt="A"></figure>
      <figure class="fig fig--wrap-right fig--sm"><img src="b.webp" alt="B"></figure>
    </div></body></html>`;
    expect(unstyled(html, '')).toEqual(['fig--sm', 'fig--wrap-right']);
  });

  it('reports a class that is out of reach for only one of several figures', () => {
    const html = `<!doctype html><html><body>
      <div class="post__content"><figure class="fig fig--center fig--md"><img src="a.webp" alt="A"></figure></div>
      <div class="page"><figure class="fig fig--center fig--md"><img src="b.webp" alt="B"></figure></div>
    </body></html>`;
    const css =
      '.post__content .fig--center { margin-inline: auto; } .fig--md { width: 20rem; }';
    expect(unstyled(html, css)).toEqual(['fig--center']);
  });
});

/**
 * The two findings carry very different weight, so they're reported differently. Styling
 * that exists and fails to land is somebody's bug; styling a theme never wrote is a note,
 * because the figure falls back to the generic `.fig` rule and may look perfectly fine.
 */
describe('findUnstyledFigureClasses — why a class is unstyled', () => {
  it('calls it scoped-out when rules exist but miss the figure', () => {
    const css =
      '.post__content .fig--wrap-right { float: right; } .fig--sm { width: 12rem; }';
    expect(findUnstyledFigureClasses(page('page'), css)).toEqual([
      { className: 'fig--wrap-right', status: 'scoped-out' },
    ]);
  });

  it('calls it absent when the theme never mentions the class', () => {
    // Drawn from life: anatole's figure port has no `--center` modifier, and its base
    // `.fig` rule centres anyway — so this is worth saying but is not a broken page.
    const html = page('post__content', 'fig fig--center fig--md');
    const css =
      '.post__content .fig { margin: 0 auto; text-align: center; } .fig--md { max-width: 75%; }';
    expect(findUnstyledFigureClasses(html, css)).toEqual([
      { className: 'fig--center', status: 'absent' },
    ]);
  });

  it('prefers scoped-out over absent when figures on one page disagree', () => {
    const html = `<!doctype html><html><body>
      <div class="post__content"><figure class="fig fig--center fig--md"><img src="a.webp" alt="A"></figure></div>
      <div class="page"><figure class="fig fig--center fig--md"><img src="b.webp" alt="B"></figure></div>
    </body></html>`;
    const css =
      '.post__content .fig--center { margin-inline: auto; } .fig--md { width: 20rem; }';
    expect(findUnstyledFigureClasses(html, css)).toEqual([
      { className: 'fig--center', status: 'scoped-out' },
    ]);
  });
});

describe('findUnstyledFigureClasses — a stylesheet jsdom cannot parse', () => {
  /** What the generator injects for an embed: a baseline wrapped in a cascade layer. */
  const LAYERED = '@layer timber.embed{.embed{aspect-ratio:16/9}}';

  it('says nothing about a page carrying one, and does not print to the console', () => {
    // jsdom's CSS parser predates `@layer` and narrates what it can't read. The check
    // already promises silence for CSS it can't parse; this keeps that promise for a
    // sheet jsdom chokes on while parsing the document itself.
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => {
      errors.push(args);
    };
    try {
      const html = `<!doctype html><html><head><style>${LAYERED}</style>
        <link rel="stylesheet" href="/assets/theme.css"></head>
        <body><main><div class="post__content">
          <figure class="fig fig--wrap-right fig--sm"><img src="a.webp" alt="A"></figure>
        </div></main></body></html>`;
      expect(
        unstyled(html, `.post__content .fig--wrap-right{float:right}${FIG_CSS}`),
      ).toEqual([]);
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([]);
  });

  it('still reports a genuinely unstyled class on such a page', () => {
    // The layered sheet contributes no selectors, which can only make this warn *less* —
    // never invent a warning.
    const html = `<!doctype html><html><head><style>${LAYERED}</style>
      <link rel="stylesheet" href="/assets/theme.css"></head>
      <body><main><div class="post__content">
        <figure class="fig fig--wrap-left"><img src="a.webp" alt="A"></figure>
      </div></main></body></html>`;
    expect(unstyled(html, FIG_CSS)).toEqual(['fig--wrap-left']);
  });
});
