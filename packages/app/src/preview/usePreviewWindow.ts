import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizePreviewDocument } from './sanitizePreview.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/** A minimal standalone document for the render-error case (no themed page to show). */
function errorDoc(message: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Timber preview</title></head><body>' +
    `<pre style="color:#c0392b;white-space:pre-wrap;font-family:system-ui;padding:2rem">${escapeHtml(message)}</pre>` +
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
    // The popup is opened with `window.open('')` — a SAME-ORIGIN document with a live
    // `opener` handle back to this token-holding app, and `document.write` parses a
    // full document so any `<script>` in the rendered page would EXECUTE. Sanitize the
    // whole document (scripts/handlers stripped, theme `<style>` kept) before writing so
    // it can't reach `opener`/the token — the pop-out's analogue of the pane's sandbox.
    const doc = error ? errorDoc(error) : sanitizePreviewDocument(html);
    w.document.open();
    w.document.write(doc);
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
