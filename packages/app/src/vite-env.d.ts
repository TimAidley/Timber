/// <reference types="vite/client" />

import type { RuntimeConfig } from './github/config.js';

declare global {
  interface Window {
    /** Per-site runtime config injected by `public/config.js` (see config.ts). */
    __TIMBER_CONFIG__?: RuntimeConfig;
  }
}
