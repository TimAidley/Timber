import { beforeEach, describe, expect, it } from 'vitest';
import { renderPage } from '../src/index.js';

/**
 * The click-to-load script is the one part of an embed that string assertions can't
 * reach: everything else is markup, but a play button that doesn't swap in the iframe
 * is the whole feature failing. So this runs the **injected script itself** — pulled
 * out of a rendered page, not a copy — against a real DOM.
 *
 * jsdom only, so it is skipped in the `node` project that runs the same specs (see
 * vitest.workspace.ts); the assertions above it cover both.
 */
const hasDom = typeof document !== 'undefined';

const GAME = 'https://tim.aidley.com/redbaron/';

async function renderedPage(mode: 'inline' | 'newtab' = 'inline'): Promise<string> {
  return renderPage({
    markdown: `---\ntitle: Red Baron\ngame: ${GAME}\n---\n`,
    template:
      `<html><head></head><body>` +
      `{% embed url: page.game, poster: 'game.webp', label: page.title, mode: '${mode}' %}` +
      `</body></html>`,
  });
}

function bodyOf(html: string): string {
  return (
    /<body>([\s\S]*?)<script>/.exec(html)?.[1] ??
    /<body>([\s\S]*?)<\/body>/.exec(html)![1]!
  );
}

function scriptOf(html: string): string {
  return /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
}

/**
 * Click `target` and report whether the script took the event over.
 *
 * The observer is registered *after* the script's own listener, so it sees exactly what
 * the script decided — and then prevents the default itself, which stops jsdom from
 * attempting the real navigation an un-hijacked anchor click would perform (it can't,
 * and says so on stderr).
 */
function click(target: Element, init: MouseEventInit = {}): boolean {
  let handledByScript = false;
  const observer = (e: Event): void => {
    handledByScript = e.defaultPrevented;
    e.preventDefault();
  };
  document.addEventListener('click', observer);
  target.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
  );
  document.removeEventListener('click', observer);
  return handledByScript;
}

describe.skipIf(!hasDom)('the injected click-to-load script', () => {
  let script: string;

  beforeEach(async () => {
    const html = await renderedPage();
    document.body.innerHTML = bodyOf(html);
    script = scriptOf(html);
    // Each spec installs its own listener on a fresh document body.
    new Function(script)();
  });

  it('replaces the poster link with the iframe on a plain click', () => {
    expect(click(document.querySelector('.embed__poster')!)).toBe(true);

    const frame = document.querySelector('iframe.embed__frame') as HTMLIFrameElement;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('src')).toBe(GAME);
    expect(frame.getAttribute('title')).toBe('Red Baron');
    expect(frame.getAttribute('allowfullscreen')).not.toBeNull();
    // The facade is kept but taken out of the flow, so closing puts back the very same
    // poster rather than fetching it again.
    const facade = document.querySelector('.embed__launch') as HTMLElement;
    expect(facade.style.display).toBe('none');
  });

  it('works when the click lands on the play button rather than the poster', () => {
    click(document.querySelector('.embed__play-icon')!);
    expect(document.querySelector('iframe.embed__frame')).not.toBeNull();
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['middle button', { button: 1 }],
  ])(
    'leaves a %s click to the browser, so open-in-new-tab still works',
    (_name, init) => {
      expect(click(document.querySelector('.embed__poster')!, init)).toBe(false);
      expect(document.querySelector('iframe.embed__frame')).toBeNull();
      expect(document.querySelector('.embed__launch')).not.toBeNull();
    },
  );

  it('ignores a click outside any embed', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<a id="other" href="/elsewhere">elsewhere</a>',
    );
    expect(click(document.getElementById('other')!)).toBe(false);

    expect(document.querySelector('iframe.embed__frame')).toBeNull();
  });
});

describe.skipIf(!hasDom)('resizing on activation', () => {
  it('re-shapes the box to the frame values, and leaves the ones not given', async () => {
    const html = await renderPage({
      markdown: `---\ntitle: t\ngame: ${GAME}\n---\n`,
      template:
        `<html><head></head><body>` +
        `{% embed url: page.game, poster: 'game.webp', ratio: '16 / 9', width: '100%',` +
        ` frameRatio: '4 / 3' %}` +
        `</body></html>`,
    });
    document.body.innerHTML = bodyOf(html);
    new Function(scriptOf(html))();

    const box = document.querySelector('.embed') as HTMLElement;
    expect(box.style.getPropertyValue('--embed-ratio')).toBe('16 / 9');

    click(document.querySelector('.embed__poster')!);

    // On its own property, which `.embed--playing` prefers — so closing is dropping the
    // class, with nothing to put back.
    expect(box.style.getPropertyValue('--embed-frame-ratio')).toBe('4 / 3');
    expect(box.style.getPropertyValue('--embed-ratio')).toBe('16 / 9');
    // No frame width was given, so the poster's stands.
    expect(box.style.getPropertyValue('--embed-frame-width')).toBe('');
    expect(box.style.getPropertyValue('--embed-width')).toBe('100%');
    expect(box.classList.contains('embed--playing')).toBe(true);
  });
});

describe.skipIf(!hasDom)('a poster-shaped embed', () => {
  /** jsdom reports no intrinsic image size, so state it the way a loaded image would. */
  function posterSize(width: number, height: number): void {
    const img = document.querySelector('.embed__poster')!;
    Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
  }

  beforeEach(async () => {
    const html = await renderPage({
      markdown: `---\ntitle: t\ngame: ${GAME}\n---\n`,
      template:
        `<html><head></head><body>` +
        `{% embed url: page.game, poster: 'game.webp', label: page.title %}` +
        `</body></html>`,
    });
    document.body.innerHTML = bodyOf(html);
    new Function(scriptOf(html))();
  });

  it('starts with no ratio of its own, so the image sizes the box', () => {
    const box = document.querySelector('.embed') as HTMLElement;
    expect(box.style.getPropertyValue('--embed-ratio').trim()).toBe('auto');
  });

  it('takes the poster’s shape at the swap, so the page does not jump', () => {
    posterSize(800, 600);
    click(document.querySelector('.embed__poster')!);

    const box = document.querySelector('.embed') as HTMLElement;
    expect(box.style.getPropertyValue('--embed-frame-ratio')).toBe('800/600');
    expect(document.querySelector('iframe.embed__frame')).not.toBeNull();
  });

  it('falls back to a real ratio when the poster never loaded', () => {
    // An iframe has no intrinsic size: leaving the box on `auto` would collapse it.
    posterSize(0, 0);
    click(document.querySelector('.embed__poster')!);

    const box = document.querySelector('.embed') as HTMLElement;
    expect(box.style.getPropertyValue('--embed-frame-ratio')).toBeTruthy();
    expect(box.style.getPropertyValue('--embed-frame-ratio')).not.toBe('auto');
  });
});

describe.skipIf(!hasDom)('a newtab embed', () => {
  it('is left alone by the script — it is already a working link', async () => {
    const inline = await renderedPage('inline');
    document.body.innerHTML = bodyOf(await renderedPage('newtab'));
    new Function(scriptOf(inline))();

    expect(click(document.querySelector('.embed__poster')!)).toBe(false);

    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe.skipIf(!hasDom)('closing a loaded embed', () => {
  beforeEach(async () => {
    const html = await renderPage({
      markdown: `---\ntitle: Red Baron\ngame: ${GAME}\n---\n`,
      template:
        `<html><head></head><body><main>` +
        `{% embed url: page.game, poster: 'game.webp', label: page.title, ratio: '16 / 9' %}` +
        `</main></body></html>`,
    });
    document.body.innerHTML = /<main>([\s\S]*?)<\/main>/.exec(html)![1]!;
    new Function(scriptOf(html))();
    click(document.querySelector('.embed__poster')!);
  });

  const closeButton = (): HTMLElement =>
    document.querySelector('.embed__close') as HTMLElement;

  it('offers a way back in the gutter beside the embed, not over it', () => {
    const bar = document.querySelector('.embed__bar')!;
    const box = document.querySelector('.embed')!;
    // Outside the box — `.embed` clips its contents, and a control over an iframe is
    // one the page can only half see. It belongs to the wrapper, whose reserved gutter
    // it is positioned into.
    expect(box.contains(bar)).toBe(false);
    expect(bar.parentElement).toBe(document.querySelector('.embed-wrap'));
    expect(bar.parentElement!.contains(box)).toBe(true);
    expect(closeButton().getAttribute('aria-label')).toBe('Close Red Baron');
  });

  it('appears in space the page was already holding, so nothing moves', () => {
    // The gutters are on the wrapper from the start, whether or not anything is playing.
    const wrap = document.querySelector('.embed-wrap')!;
    expect(wrap.className).toContain('embed-wrap--inline');
  });

  it('unloads the third party, which is the point of closing it', () => {
    click(closeButton());
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('puts the poster back, and takes the bar away with the frame', () => {
    click(closeButton());

    const facade = document.querySelector('.embed__launch') as HTMLElement;
    expect(facade.style.display).toBe('');
    expect(document.querySelector('.embed__bar')).toBeNull();
    expect(document.querySelector('.embed')!.classList.contains('embed--playing')).toBe(
      false,
    );
  });

  it('leaves focus somewhere useful — on the control that reopens it', () => {
    click(closeButton());
    expect(document.activeElement).toBe(document.querySelector('.embed__launch'));
  });

  it('can be opened again afterwards', () => {
    click(closeButton());
    click(document.querySelector('.embed__poster')!);

    expect(document.querySelector('iframe.embed__frame')).not.toBeNull();
    expect(document.querySelectorAll('.embed__bar')).toHaveLength(1);
  });

  it('is a button, so a keyboard reaches it', () => {
    expect(closeButton().tagName).toBe('BUTTON');
    expect(closeButton().getAttribute('type')).toBe('button');
  });
});

describe.skipIf(!hasDom)('a newtab embed', () => {
  it('never gets a close control, having nothing to close', async () => {
    const html = await renderPage({
      markdown: `---\ntitle: t\ngame: ${GAME}\n---\n`,
      template:
        `<html><head></head><body>` +
        `{% embed url: page.game, poster: 'game.webp', mode: 'newtab' %}` +
        `</body></html>`,
    });
    document.body.innerHTML = bodyOf(html);

    click(document.querySelector('.embed__poster')!);
    expect(document.querySelector('.embed__bar')).toBeNull();
  });
});
