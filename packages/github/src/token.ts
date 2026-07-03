/**
 * The auth seam (SPEC §9): the rest of the app only ever needs "a valid token" —
 * the mechanism (pasted PAT for dev, an OAuth broker, a GitHub App flow later) can
 * be swapped without touching callers. `RepoClient` depends only on this type.
 */
export type GetToken = () => Promise<string>;

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
