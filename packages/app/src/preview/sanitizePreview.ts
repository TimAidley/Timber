import DOMPurify from 'dompurify';

/**
 * DOMPurify's default URI allowlist rejects `blob:` — but the live preview rewrites
 * staged-image paths to `URL.createObjectURL(...)` object URLs (see `useRenderedPreview`),
 * so those `blob:` `img src`s must survive. This is the DOMPurify default
 * `ALLOWED_URI_REGEXP` with `blob` added to the scheme alternation (the documented way
 * to permit an extra protocol); `data:` images are already allowed by the default.
 */
const PREVIEW_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

/**
 * Sanitize generator-rendered HTML before it is injected into the app's own DOM /
 * a same-origin preview window. The app origin holds the GitHub token, so even
 * though the generator now HTML-escapes front matter and sanitizes body URLs, this
 * is the defense-in-depth layer that guarantees no `<script>` / `onerror` / `javascript:`
 * from rendered content can execute in the token-holding origin.
 */
export function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP: PREVIEW_URI_REGEXP });
}

/**
 * Sanitize a *whole* rendered page document (with `<html>/<head>/<style>`) for the
 * popped-out preview window. Unlike the in-pane preview — which is an un-scripted
 * sandboxed iframe — the pop-out is a real same-origin window with a live `opener`
 * handle back to this token-holding app, so any `<script>` in the rendered page would
 * run with access to the token. `WHOLE_DOCUMENT` keeps the theme's `<style>`/`<head>`
 * intact while stripping every script and inline handler; `blob:` object URLs (images,
 * fonts) survive via the shared allowlist.
 */
export function sanitizePreviewDocument(html: string): string {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ALLOWED_URI_REGEXP: PREVIEW_URI_REGEXP,
  });
}
