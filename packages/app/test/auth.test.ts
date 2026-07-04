import { describe, expect, it } from 'vitest';
import { authMode } from '../src/github/auth.js';

describe('auth mode selection', () => {
  it('defaults to the dev PAT gate when OAuth env vars are absent', () => {
    // No VITE_TIMBER_OAUTH_* set in the test env → dev paste-a-PAT fallback.
    expect(authMode).toBe('pat');
  });
});
