import { defineConfig } from 'vitest/config';

// The end-to-end project: the REAL editor (served by Vite) in REAL headless Chromium,
// with every `api.github.com` request answered by `@timber/fake-github` through a
// Playwright route. Nothing is mocked inside the app — it signs in, loads, autosaves and
// publishes exactly as it would against GitHub; only the network is fake.
//
// Vitest here runs in Node and drives the browser (unlike vitest.browser.config.ts, where
// the tests themselves run inside the browser). Like that config, this one is NOT in
// vitest.workspace.ts: `pnpm test` never launches a browser or a dev server. Run it with
// `pnpm test:e2e` after `pnpm -r build` (the app resolves the workspace packages' dist).
export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['test/e2e/**/*.e2e.ts'],
    // One Vite server + one browser per file; a whole flow (sign in → autosave → publish
    // → deploy) is a single test that legitimately takes seconds.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
