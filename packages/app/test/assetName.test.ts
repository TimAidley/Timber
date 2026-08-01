import { describe, expect, it } from 'vitest';
import {
  bundleImagePath,
  bundleRelativeSrc,
  bodySrcToRepoPath,
} from '../src/media/assetName.js';

/**
 * Two coordinate systems meet in a bundle image, and confusing them is invisible until
 * something renders:
 *
 * - the **repo path** (`content/posts/hello/images/p.webp`) — how the asset store, the
 *   autosaver and git all refer to the file;
 * - the **body src** (`images/p.webp`) — page-relative, because the build copies a
 *   bundle's files next to the page it renders.
 *
 * Writing a repo path into a body produces a src that resolves in the editor and 404s on
 * the published page; handing a body src to the store produces the reverse.
 */
describe('bundle asset paths', () => {
  const dir = 'content/posts/hello';

  it('stages under the repo path and writes the page-relative src', () => {
    const repoPath = bundleImagePath(dir, 'My Photo.PNG', 'image/webp');
    expect(repoPath).toBe('content/posts/hello/images/my-photo.webp');
    expect(bundleRelativeSrc(dir, repoPath)).toBe('images/my-photo.webp');
  });

  it('round-trips a body src back to its repo path', () => {
    expect(bodySrcToRepoPath(dir, 'images/my-photo.webp')).toBe(
      'content/posts/hello/images/my-photo.webp',
    );
  });

  it('resolves a bare filename against the bundle', () => {
    // How an imported page bundle refers to its own images.
    expect(bodySrcToRepoPath(dir, 'photo.jpg')).toBe('content/posts/hello/photo.jpg');
  });

  it('accepts a repo path written straight into the body', () => {
    // What the editor used to insert; existing content still has to display.
    expect(bodySrcToRepoPath(dir, 'content/posts/hello/images/p.webp')).toBe(
      'content/posts/hello/images/p.webp',
    );
  });

  it('treats a site-wide reference as a repo path', () => {
    expect(bodySrcToRepoPath(dir, '/assets/logo.png')).toBe('assets/logo.png');
  });

  it('resolves ./ and ../ segments', () => {
    expect(bodySrcToRepoPath(dir, './a/../b.png')).toBe('content/posts/hello/b.png');
  });

  it('claims nothing it does not own', () => {
    expect(bodySrcToRepoPath(dir, 'https://x.test/a.png')).toBeUndefined();
    expect(bodySrcToRepoPath(dir, '//cdn.test/a.png')).toBeUndefined();
    expect(bodySrcToRepoPath(dir, 'data:image/png;base64,AAA')).toBeUndefined();
    expect(bodySrcToRepoPath(dir, '')).toBeUndefined();
  });

  it('leaves a src that is already page-relative alone when re-derived', () => {
    // `bundleRelativeSrc` is only meant to strip a matching bundle prefix.
    expect(bundleRelativeSrc(dir, 'images/p.webp')).toBe('images/p.webp');
  });
});
