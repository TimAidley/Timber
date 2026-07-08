import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Inject the per-site runtime config script (public/config.js) into <head> BEFORE the
// app module, so `window.__TIMBER_CONFIG__` exists when the app reads it (config.ts).
// Done as a classic (non-module) script via a plugin rather than a tag in index.html
// so Vite doesn't try to bundle it (it's a verbatim public asset, overwritten per site).
function timberConfigScript(): Plugin {
  return {
    name: 'timber-config-script',
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { src: './config.js' }, injectTo: 'head-prepend' }];
    },
  };
}

// The browser editor SPA. The generator/content/github packages are consumed as
// workspace libraries (their built dist), so Vite just bundles this app + React +
// Milkdown. No server-side anything — the output is a static single-page app.
//
// Base path defaults to **relative** (`./`) so the SAME built bundle works at any
// subpath — the fork-and-go deploy co-hosts the editor at `/<repo>/admin/` on the
// site's GitHub Pages (SPEC §3) — with NO build-time base var. (This is a flat SPA
// with no deep client-side routes, so relative asset URLs resolve correctly.)
// `TIMBER_BASE` can still pin an absolute base if a particular deploy needs one.
export default defineConfig({
  base: process.env.TIMBER_BASE || './',
  plugins: [react(), timberConfigScript()],
});
