import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizePreviewDocument } from './sanitizePreview.js';
import { findChangedElement } from './previewScroll.js';

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
 *
 * Rewriting resets the window's scroll, so — like the pane (see previewScroll.ts) — each
 * rewrite restores the previous scroll offset and scrolls the edited element into view.
 * `contentKey` identifies the previewed page: when it changes, the mirror is a different
 * page and starts fresh at the top instead of restoring the previous page's scroll.
 */
export function usePreviewWindow(
  html: string,
  error: string | null,
  contentKey?: string,
): { isOpen: boolean; open: () => void; close: () => void } {
  const winRef = useRef<Window | null>(null);
  const prevKeyRef = useRef(contentKey);
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
    // Unlike the pane's frame, the old document is still live here, so its scroll offset
    // and <body> can be captured directly (the clone must precede `document.open`, which
    // empties the document). Only meaningful when the rewrite is the SAME page re-rendered.
    const samePage = prevKeyRef.current === contentKey && !error;
    const scroll = samePage ? { x: w.scrollX, y: w.scrollY } : null;
    const before = samePage ? (w.document.body?.cloneNode(true) as Element | null) : null;
    w.document.open();
    w.document.write(doc);
    w.document.close();
    prevKeyRef.current = contentKey;
    if (!scroll) return;
    w.scrollTo(scroll.x, scroll.y);
    const body = w.document.body;
    const changed = before && body ? findChangedElement(before, body) : null;
    if (changed && changed !== body) changed.scrollIntoView({ block: 'nearest' });
  }, [html, error, isOpen, contentKey]);

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
