import { describe, expect, it } from 'vitest';
import { themeStyle } from '../src/theme.js';
import { siteContext } from '../src/seo.js';
import type { ContentObject } from '../src/types.js';

describe('themeStyle', () => {
  it('emits validated CSS variable overrides for the set knobs', () => {
    const css = themeStyle({
      accentColor: '#3457d5',
      textColor: '#111111',
      backgroundColor: '#ffffff',
      bodyFont: 'sans',
      headingFont: 'serif',
      contentWidth: 'wide',
    });
    expect(css).toContain('--accent: #3457d5;');
    expect(css).toContain('--fg: #111111;');
    expect(css).toContain('--bg: #ffffff;');
    expect(css).toContain('--font-body: system-ui');
    expect(css).toContain("--font-heading: 'Source Serif 4'");
    expect(css).toContain('--maxw: 60rem;');
    expect(css.startsWith(':root {')).toBe(true);
  });

  it('is empty when nothing is set', () => {
    expect(themeStyle({})).toBe('');
    expect(themeStyle({ title: 'Unrelated' })).toBe('');
  });

  it('accepts 3-, 6-, and 8-digit hex', () => {
    expect(themeStyle({ accentColor: '#abc' })).toContain('--accent: #abc;');
    expect(themeStyle({ accentColor: '#aabbcc' })).toContain('--accent: #aabbcc;');
    expect(themeStyle({ accentColor: '#aabbccdd' })).toContain('--accent: #aabbccdd;');
  });

  it('drops a non-hex colour rather than injecting it (CSS-injection guard)', () => {
    // A hand-edited value that tries to break out of the declaration must not appear.
    const css = themeStyle({ accentColor: 'red; } body { display: none } .x {' });
    expect(css).toBe('');
    expect(themeStyle({ accentColor: 'rgb(1,2,3)' })).toBe('');
    expect(themeStyle({ accentColor: 'blue' })).toBe('');
  });

  it('drops unknown enum values for fonts and width', () => {
    expect(themeStyle({ bodyFont: 'comic-sans' })).toBe('');
    expect(themeStyle({ contentWidth: 'gigantic' })).toBe('');
  });

  it('emits only the valid subset when some knobs are bad', () => {
    const css = themeStyle({ accentColor: '#123456', textColor: 'not-a-colour' });
    expect(css).toBe(':root { --accent: #123456; }');
  });
});

describe('siteContext.themeStyle', () => {
  const settings = (data: Record<string, unknown>): ContentObject => ({
    type: 'settings',
    kind: 'singleton',
    slug: 'settings',
    path: 'content/settings/index.md',
    data,
    body: '',
    public: true,
  });

  it('exposes the override block on the site context', () => {
    const site = siteContext(settings({ accentColor: '#3457d5' }));
    expect(site.themeStyle).toBe(':root { --accent: #3457d5; }');
  });

  it('is an empty string when there is no settings object', () => {
    expect(siteContext(undefined).themeStyle).toBe('');
  });
});
