import type { GetToken } from '@timber/host';

// The `GetToken` seam now lives in the host port; re-export it so existing
// `@timber/github` importers are unaffected.
export type { GetToken } from '@timber/host';

/**
 * A Node/dev `GetToken`: reads a fine-grained PAT from an environment variable.
 * This is Phase 2's implementation of the seam; the browser paste-a-PAT UI is
 * Phase 4's job and will implement the same `GetToken` type differently.
 */
export function fromEnv(varName: string): GetToken {
  return async () => {
    const token = process.env[varName];
    if (!token) {
      throw new Error(`GetToken: environment variable "${varName}" is not set`);
    }
    return token;
  };
}
