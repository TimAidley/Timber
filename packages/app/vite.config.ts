import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser editor SPA. The generator/content/github packages are consumed as
// workspace libraries (their built dist), so Vite just bundles this app + React +
// Milkdown. No server-side anything — the output is a static single-page app.
//
// `TIMBER_BASE` sets the public base path so the same app can be served from a
// subpath — the fork-and-go deploy co-hosts the editor at `/<repo>/admin/` on the
// site's GitHub Pages (SPEC §3). Assets emit relative to it; unset ⇒ `/` (local dev).
export default defineConfig({
  base: process.env.TIMBER_BASE || '/',
  plugins: [react()],
});
