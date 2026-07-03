import { defineWorkspace } from 'vitest/config';

// Two projects run the SAME specs under different environments so the fidelity
// test proves the generator core produces byte-identical output in Node and in a
// browser-like DOM environment (jsdom). If anything Node-only leaks into the core,
// the "browser" project fails.
export default defineWorkspace([
  {
    test: {
      name: 'node',
      environment: 'node',
      include: ['packages/**/test/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'browser-like',
      environment: 'jsdom',
      include: ['packages/**/test/**/*.test.ts'],
    },
  },
]);
