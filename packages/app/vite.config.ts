import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser editor SPA. The generator/content/github packages are consumed as
// workspace libraries (their built dist), so Vite just bundles this app + React +
// Milkdown. No server-side anything — the output is a static single-page app.
export default defineConfig({
  plugins: [react()],
});
