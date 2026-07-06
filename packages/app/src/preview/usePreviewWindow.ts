import { useCallback, useEffect, useRef, useState } from 'react';

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/** Wrap the rendered body fragment in a minimal standalone document for the window. */
function wrapDoc(inner: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Timber preview</title>' +
    '<style>body{margin:0;padding:2rem;font-family:system-ui,-apple-system,sans-serif;' +
    'line-height:1.5;max-width:820px}img{max-width:100%}</style></head><body>' +
    inner +
    '</body></html>'
  );
}

/**
 * Pop the live preview into its own browser window (SPEC §8). The preview runs the
 * real generator, so a full-width window is a truer full-page preview than the pane —
 * useful on a second monitor. While open, the window is rewritten whenever the render
 * changes; the user closing it (or this component unmounting) tears the mirror down.
 */
export function usePreviewWindow(
  html: string,
  error: string | null,
): { isOpen: boolean; open: () => void; close: () => void } {
  const winRef = useRef<Window | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const close = useCallback(() => {
    winRef.current?.close();
    winRef.current = null;
    setIsOpen(false);
  }, []);

  const open = useCallback(() => {
    const w = window.open('', 'timber-preview', 'width=900,height=800');
    if (!w) return; // popup blocked — silently no-op
    winRef.current = w;
    setIsOpen(true);
  }, []);

  // Mirror the current render into the window whenever it (or the error) changes.
  useEffect(() => {
    const w = winRef.current;
    if (!isOpen || !w || w.closed) return;
    const body = error
      ? `<pre style="color:#c0392b;white-space:pre-wrap">${escapeHtml(error)}</pre>`
      : html;
    w.document.open();
    w.document.write(wrapDoc(body));
    w.document.close();
  }, [html, error, isOpen]);

  // Notice the user closing the popped-out window so the button reflects it.
  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => {
      if (winRef.current?.closed) {
        winRef.current = null;
        setIsOpen(false);
      }
    }, 800);
    return () => clearInterval(timer);
  }, [isOpen]);

  // Don't leave an orphaned window behind if the editor unmounts.
  useEffect(() => () => winRef.current?.close(), []);

  return { isOpen, open, close };
}
