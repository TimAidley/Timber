import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The app is browser-only React, so its tests need the React plugin (JSX) and a
// DOM environment. It is deliberately its OWN vitest project — the `node` and
// `browser-like` projects (which prove the pure packages are isomorphic) exclude
// `packages/app` precisely because this package is NOT part of that proof.
export default defineProject({
  plugins: [react()],
  test: {
    name: 'app',
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
