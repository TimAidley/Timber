import { describe, expect, it } from 'vitest';
import {
  classifyUpload,
  extensionOf,
  MAX_ASSET_BYTES,
  ALLOWED_EXTS,
} from '../src/media/assetPolicy.js';
import { siteAssetPath } from '../src/media/assetName.js';

describe('extensionOf', () => {
  it('lower-cases the extension and ignores path/dots in the stem', () => {
    expect(extensionOf('Logo.WOFF2')).toBe('woff2');
    expect(extensionOf('assets/fonts/My.Font.v2.ttf')).toBe('ttf');
    expect(extensionOf('.gitkeep')).toBe(''); // leading dot only → no extension
    expect(extensionOf('README')).toBe('');
  });
});

describe('classifyUpload', () => {
  it('routes images through the pipeline', () => {
    for (const name of ['photo.png', 'a.JPG', 'b.jpeg', 'c.webp', 'd.avif', 'e.gif', 'f.svg']) {
      expect(classifyUpload(name, 1000)).toEqual({ action: 'process' });
    }
  });

  it('passes fonts through with their served MIME', () => {
    expect(classifyUpload('font.woff2', 1000)).toEqual({
      action: 'passthrough',
      mime: 'font/woff2',
    });
    expect(classifyUpload('font.otf', 1000)).toEqual({ action: 'passthrough', mime: 'font/otf' });
  });

  it('passes a favicon through as an icon rather than re-encoding it to WebP', () => {
    // The key correctness point: .ico is image-like but must NOT hit the canvas pipeline.
    expect(classifyUpload('favicon.ico', 1000)).toEqual({
      action: 'passthrough',
      mime: 'image/x-icon',
    });
  });

  it('passes a PDF through', () => {
    expect(classifyUpload('menu.pdf', 1000)).toEqual({
      action: 'passthrough',
      mime: 'application/pdf',
    });
  });

  it('rejects disallowed extensions with a helpful reason', () => {
    const decision = classifyUpload('malware.exe', 1000);
    expect(decision.action).toBe('reject');
    if (decision.action === 'reject') {
      expect(decision.reason).toMatch(/\.exe/);
      expect(decision.reason).toMatch(/allowed/i);
    }
  });

  it('rejects a file with no extension', () => {
    const decision = classifyUpload('LICENSE', 1000);
    expect(decision.action).toBe('reject');
    if (decision.action === 'reject') expect(decision.reason).toMatch(/extension/i);
  });

  it('rejects an over-cap file before looking at its type', () => {
    const decision = classifyUpload('huge.png', MAX_ASSET_BYTES + 1);
    expect(decision.action).toBe('reject');
    if (decision.action === 'reject') expect(decision.reason).toMatch(/too large/i);
  });

  it('accepts a file exactly at the cap', () => {
    expect(classifyUpload('big.webp', MAX_ASSET_BYTES)).toEqual({ action: 'process' });
  });

  it('lists every allowed extension in the reject hint', () => {
    const decision = classifyUpload('x.zip', 1000);
    if (decision.action === 'reject') {
      for (const ext of ALLOWED_EXTS) expect(decision.reason).toContain(ext);
    }
  });
});

describe('siteAssetPath', () => {
  it('slugifies the name and lands it under assets/ with the given extension', () => {
    expect(siteAssetPath('My Logo.png', 'webp')).toBe('assets/my-logo.webp');
    expect(siteAssetPath('Source Serif 4.woff2', 'woff2')).toBe('assets/source-serif-4.woff2');
  });
});
