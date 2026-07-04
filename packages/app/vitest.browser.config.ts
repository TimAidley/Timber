import { defineConfig } from 'vitest/config';

// The real-browser test project. The image re-encode path (createImageBitmap →
// OffscreenCanvas → WebP) uses browser APIs jsdom does not implement, so these
// specs run in actual headless Chromium via Vitest's Playwright provider (the
// browser is pre-installed at PLAYWRIGHT_BROWSERS_PATH).
//
// This config is NOT part of vitest.workspace.ts, so `pnpm test` never launches a
// browser. It runs only via `pnpm test:browser`, mirroring how the network `live`
// suite is kept out of the default run.
export default defineConfig({
  // Pin the root to this package so `test/**` resolves here rather than at the
  // repo root where `vitest run --config …` is invoked.
  root: import.meta.dirname,
  test: {
    include: ['test/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      name: 'chromium',
      headless: true,
    },
  },
});
