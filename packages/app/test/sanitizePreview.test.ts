import { describe, expect, it } from 'vitest';
import { sanitizePreviewHtml } from '../src/preview/sanitizePreview.js';

/**
 * The preview is injected into the app's own (token-holding) origin, so rendered
 * content must be sanitized. But staged images are previewed via `blob:` object URLs,
 * which DOMPurify strips by default — these assert both properties hold.
 */
describe('sanitizePreviewHtml', () => {
  it('strips event-handler XSS (cannot run in the token origin)', () => {
    const out = sanitizePreviewHtml('<img src="x" onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain('onerror');
  });

  it('strips <script> and javascript: URLs', () => {
    const out = sanitizePreviewHtml('<script>alert(1)</script><a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/<script/i);
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('keeps blob: image URLs (staged-image preview)', () => {
    const out = sanitizePreviewHtml('<img src="blob:https://app.example/abc-123">');
    expect(out).toContain('blob:https://app.example/abc-123');
  });

  it('keeps data: image URLs and ordinary markup', () => {
    const out = sanitizePreviewHtml(
      '<figure><img src="data:image/png;base64,iVBORw0KGgo="><figcaption>hi</figcaption></figure>',
    );
    expect(out).toContain('data:image/png;base64');
    expect(out).toContain('<figcaption>hi</figcaption>');
  });
});
