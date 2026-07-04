import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '../src/media/sanitizeSvg.js';

/**
 * SVG is a stored-XSS vector (SPEC §7). These assert the concrete attack surface is
 * removed while legitimate vector content survives — the security boundary Phase 5
 * relies on when it commits staged bytes.
 */
describe('sanitizeSvg', () => {
  it('strips <script> elements', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('alert(1)');
    expect(out).toMatch(/<rect/i);
  });

  it('strips inline event handlers', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="5"/></svg>');
    expect(out.toLowerCase()).not.toContain('onload');
    expect(out).toMatch(/<circle/i);
  });

  it('strips javascript: URIs', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>x</text></a></svg>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('keeps legitimate vector content', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>');
    expect(out).toMatch(/<path/i);
    expect(out).toContain('M4 4h16v16H4z');
  });
});
