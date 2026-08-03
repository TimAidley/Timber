import { describe, expect, it } from 'vitest';
import { findChangedElement } from '../src/preview/previewScroll.js';

/**
 * The preview frame reloads on every keystroke render, so the pane diffs the previous
 * render's <body> against the new one to find — and keep in view — the element the
 * author just edited (SPEC §8). These pin the diff down to the edit point for the
 * shapes a keystroke produces: text edited in place, blocks added/removed, and the
 * no-change case (only the <head> differed) where the pane must not jump at all.
 */

function body(html: string): HTMLElement {
  const el = document.createElement('body');
  el.innerHTML = html;
  return el;
}

describe('findChangedElement', () => {
  it('returns null when nothing in the body changed', () => {
    const a = body('<h1>Title</h1><p>One</p><p>Two</p>');
    const b = body('<h1>Title</h1><p>One</p><p>Two</p>');
    expect(findChangedElement(a, b)).toBeNull();
  });

  it('finds the paragraph whose text was edited (typing)', () => {
    const a = body('<h1>Title</h1><p>One</p><p>Two</p>');
    const b = body('<h1>Title</h1><p>One</p><p>Two more</p>');
    const changed = findChangedElement(a, b);
    expect(changed?.outerHTML).toBe('<p>Two more</p>');
  });

  it('localizes to the innermost changed element', () => {
    const a = body('<article><section><p>Deep <em>text</em></p></section></article>');
    const b = body('<article><section><p>Deep <em>texts</em></p></section></article>');
    expect(findChangedElement(a, b)?.outerHTML).toBe('<em>texts</em>');
  });

  it('anchors on a newly added block (pressing Enter for a new paragraph)', () => {
    const a = body('<p>One</p>');
    const b = body('<p>One</p><p>Two</p>');
    expect(findChangedElement(a, b)?.outerHTML).toBe('<p>Two</p>');
  });

  it('anchors near a removed block', () => {
    const a = body('<p>One</p><p>Two</p><p>Three</p>');
    const b = body('<p>One</p><p>Two</p>');
    expect(findChangedElement(a, b)?.outerHTML).toBe('<p>Two</p>');
  });

  it('finds an element replaced by a different tag', () => {
    const a = body('<p>Heading?</p><p>After</p>');
    const b = body('<h2>Heading?</h2><p>After</p>');
    expect(findChangedElement(a, b)?.outerHTML).toBe('<h2>Heading?</h2>');
  });

  it('returns the container when bare text under it changed', () => {
    const a = body('<div>loose text<p>After</p></div>');
    const b = body('<div>loose texts<p>After</p></div>');
    expect(findChangedElement(a, b)?.tagName).toBe('DIV');
  });

  it('returns the element itself on an attribute-only change', () => {
    const a = body('<p>Same</p><img src="a.webp">');
    const b = body('<p>Same</p><img src="b.webp">');
    expect(findChangedElement(a, b)?.outerHTML).toBe('<img src="b.webp">');
  });

  it('returns the body itself when it emptied', () => {
    const a = body('<p>One</p>');
    const b = body('');
    expect(findChangedElement(a, b)?.tagName).toBe('BODY');
  });

  it('compares structurally across documents (clone from a previous render)', () => {
    const a = body('<p>One</p>');
    const clone = a.cloneNode(true) as Element;
    const b = body('<p>One!</p>');
    expect(findChangedElement(clone, b)?.outerHTML).toBe('<p>One!</p>');
  });
});
