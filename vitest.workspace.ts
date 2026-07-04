import { configDefaults, defineWorkspace } from 'vitest/config';

// Two projects run the SAME specs under different environments so the fidelity
// test proves the generator core produces byte-identical output in Node and in a
// browser-like DOM environment (jsdom). If anything Node-only leaks into the core,
// the "browser" project fails.
//
// A third, separate "live" project holds *.live.test.ts specs that hit the real
// GitHub API against a dedicated sandbox repo. It's excluded from the default
// `pnpm test` run (and from the other two projects) so no test suite ever touches
// the network unless someone explicitly runs `pnpm test:live`.
export default defineWorkspace([
  {
    test: {
      name: 'node',
      environment: 'node',
      include: ['packages/**/test/**/*.test.ts'],
      exclude: [...configDefaults.exclude, '**/*.live.test.ts', 'packages/app/**'],
    },
  },
  {
    test: {
      name: 'browser-like',
      environment: 'jsdom',
      include: ['packages/**/test/**/*.test.ts'],
      exclude: [...configDefaults.exclude, '**/*.live.test.ts', 'packages/app/**'],
    },
  },
  {
    test: {
      name: 'live',
      environment: 'node',
      include: ['packages/**/test/**/*.live.test.ts'],
    },
  },
  // The browser editor app runs as its own project (jsdom + React plugin); see
  // packages/app/vitest.config.ts. It's excluded from the two projects above
  // because it's browser-only React, not part of the isomorphism proof.
  './packages/app/vitest.config.ts',
]);
