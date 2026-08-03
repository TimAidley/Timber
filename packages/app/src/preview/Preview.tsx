import { useCallback, useRef } from 'react';
import { findChangedElement } from './previewScroll.js';

interface PreviewProps {
  html: string;
  error: string | null;
}

/**
 * Presentational preview pane: renders the full page document (the site's own template +
 * theme) produced by {@link useRenderedPreview}, so the preview looks like the built page
 * rather than editor chrome (SPEC §6/§13).
 *
 * It renders in an iframe rather than inline, both to isolate the site theme's CSS from
 * the editor and to protect the GitHub token: the app origin holds the token, so the
 * frame is sandboxed WITHOUT `allow-scripts` — no script (or inline handler) in the
 * rendered page can execute, so it can never reach `window.parent` or the token store.
 * `allow-same-origin` is kept (without `allow-scripts` it grants no scripting power) so
 * the frame can load the `blob:` object URLs the render mints for images and theme fonts.
 *
 * Swapping `srcDoc` reloads the frame's document, which would reset scroll to the top on
 * every keystroke render — so on each load the previous scroll offset is restored and the
 * edited element is scrolled into view (see previewScroll.ts). All of that runs from this
 * (app) side of the frame; the sandbox still never lets the framed page itself script.
 * The editor keys this component by the open object, so a page switch starts fresh at the
 * top instead of restoring the previous page's scroll.
 */
export function Preview({ html, error }: PreviewProps): React.JSX.Element {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Scroll state that survives the frame's per-render reloads: the last-known scroll
  // offset — tracked by a listener, because the old document is already gone by the time
  // the new one fires `load` — and a clone of the last rendered <body> for edit-diffing.
  const scrollRef = useRef({ x: 0, y: 0 });
  const lastBodyRef = useRef<Element | null>(null);

  const handleLoad = useCallback(() => {
    const win = frameRef.current?.contentWindow;
    const body = frameRef.current?.contentDocument?.body;
    if (!win || !body) return;
    win.scrollTo(scrollRef.current.x, scrollRef.current.y);
    const previous = lastBodyRef.current;
    const changed = previous ? findChangedElement(previous, body) : null;
    // `nearest` is a no-op when the edit is already visible and otherwise scrolls just
    // far enough to reveal it. The body itself can't usefully be scrolled "into view".
    if (changed && changed !== body) changed.scrollIntoView({ block: 'nearest' });
    lastBodyRef.current = body.cloneNode(true) as Element;
    scrollRef.current = { x: win.scrollX, y: win.scrollY };
    win.addEventListener(
      'scroll',
      () => {
        scrollRef.current = { x: win.scrollX, y: win.scrollY };
      },
      { passive: true },
    );
  }, []);

  if (error) {
    return <pre className="preview preview--error">{error}</pre>;
  }
  return (
    <iframe
      ref={frameRef}
      onLoad={handleLoad}
      className="preview-frame"
      title="Page preview"
      sandbox="allow-same-origin"
      srcDoc={html}
    />
  );
}
