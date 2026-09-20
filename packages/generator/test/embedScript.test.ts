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
    expect(frame.getAttribute('title')).toBe('Play Red Baron');
    expect(frame.getAttribute('allowfullscreen')).not.toBeNull();
    // The facade is gone, not merely covered.
    expect(document.querySelector('.embed__launch')).toBeNull();
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

    expect(box.style.getPropertyValue('--embed-ratio')).toBe('4 / 3');
    // No frame width was given, so the poster's stands.
    expect(box.style.getPropertyValue('--embed-width')).toBe('100%');
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
