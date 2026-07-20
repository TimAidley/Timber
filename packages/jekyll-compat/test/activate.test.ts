import { describe, it, expect } from 'vitest';
import { setFrontMatterScalar } from '../src/activate.js';

describe('setFrontMatterScalar', () => {
  it('appends a new key inside existing front matter, preserving body + other keys', () => {
    const src = '---\ntitle: My Site\nbaseUrl: https://x.test\n---\n\nBody here.\n';
    const out = setFrontMatterScalar(src, 'activeTheme', 'minima');
    expect(out).toContain('title: My Site');
    expect(out).toContain('baseUrl: https://x.test');
    expect(out).toContain('activeTheme: minima');
    expect(out).toContain('Body here.');
  });

  it('replaces an existing key in place (no duplicate)', () => {
    const src = '---\ntitle: My Site\nactiveTheme: old\n---\n';
    const out = setFrontMatterScalar(src, 'activeTheme', 'new');
    expect(out).toContain('activeTheme: new');
    expect(out).not.toContain('activeTheme: old');
    expect(out.match(/activeTheme:/g)).toHaveLength(1);
  });

  it('adds a front-matter block when the file has none', () => {
    const out = setFrontMatterScalar('Just a body.\n', 'activeTheme', 'x');
    expect(out).toBe('---\nactiveTheme: x\n---\n\nJust a body.\n');
  });

  it('handles an empty front-matter block', () => {
    const out = setFrontMatterScalar('---\n---\n', 'activeTheme', 'x');
    expect(out).toContain('activeTheme: x');
    expect(out.startsWith('---\n')).toBe(true);
  });
});
