import { execSync } from 'node:child_process';
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

/** The Timber commit HEAD of this checkout, or undefined outside a git working tree. */
function gitHeadSha(): string | undefined {
  try {
    return (
      execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || undefined
    );
  } catch {
    return undefined; // vendored source drop / no git — no provenance, so no banner
  }
}

// Bake build provenance so the deployed editor can notice when the Timber branch it
// follows has moved past the commit it was built from, and offer a redeploy (SPEC §12).
// It stamps the vars into `process.env` (which Vite then exposes as `import.meta.env`)
// during the build so the check works **out of the box** — even for a site whose
// deploy.yml predates this feature and doesn't pass them. Explicit values (the updated
// deploy.yml exports them) always win, so forks / tag-pins can still override; the SHA
// comes from the checkout's git HEAD. `apply: 'build'` keeps the dev server clean (no
// SHA ⇒ no banner while running `vite`).
function timberBuildProvenance(): Plugin {
  return {
    name: 'timber-build-provenance',
    apply: 'build',
    config() {
      const sha = process.env.VITE_TIMBER_BUILD_SHA || gitHeadSha();
      if (sha) process.env.VITE_TIMBER_BUILD_SHA = sha;
      process.env.VITE_TIMBER_UPSTREAM_REPO ||= 'TimAidley/Timber';
      process.env.VITE_TIMBER_UPSTREAM_REF ||= 'main';
    },
  };
}

// The browser editor SPA. The generator/content/github packages are consumed as
// workspace libraries (their built dist), so Vite just bundles this app + React +
// Milkdown. No server-side anything — the output is a static single-page app.
//
// Base path defaults to **relative** (`./`) so the SAME built bundle works at any
// subpath — the fork-and-go deploy co-hosts the editor at `/<repo>/edit/` on the
// site's GitHub Pages (SPEC §3) — with NO build-time base var. (This is a flat SPA
// with no deep client-side routes, so relative asset URLs resolve correctly.)
// `TIMBER_BASE` can still pin an absolute base if a particular deploy needs one.
export default defineConfig({
  base: process.env.TIMBER_BASE || './',
  plugins: [react(), timberConfigScript(), timberBuildProvenance()],
});
