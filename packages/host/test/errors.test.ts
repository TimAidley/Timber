import { describe, expect, it } from 'vitest';
import { describeHostError, redactSecrets, summarizeHostError } from '../src/errors.js';

/**
 * The normaliser is what lets the editor say *why* a save failed instead of just
 * "Save failed — retrying" (SPEC §11). Its most load-bearing output is `retryable`:
 * an expired session fails identically forever, so promising a retry there is a lie.
 */

/** An Octokit `RequestError`-shaped throw (`@timber/github`). */
function octokitError(
  status: number,
  message: string,
  headers: Record<string, string> = {},
  data?: unknown,
): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    status,
    response: { status, headers, data: data ?? { message } },
  });
}

/** The status-carrying error the Gitea/GitLab adapters build (real `Headers`). */
function fetchAdapterError(status: number, message: string, headers: Record<string, string> = {}): Error {
  return Object.assign(new Error(`Gitea POST /x -> ${status}: ${message}`), {
    status,
    response: { status, headers: new Headers(headers), data: { message } },
  });
}

describe('describeHostError — what failed, and can a retry fix it', () => {
  it('reads an expired session as auth, and refuses to call it retryable', () => {
    const info = describeHostError(octokitError(401, 'Bad credentials'));
    expect(info.kind).toBe('auth');
    expect(info.retryable).toBe(false);
    expect(info.status).toBe(401);
    expect(info.message).toBe('Bad credentials');
    expect(summarizeHostError(info)).toBe('signed out (401)');
  });

  it('separates a rate limit from a plain permission denial (both 403)', () => {
    const limited = describeHostError(
      octokitError(403, 'You have exceeded a secondary rate limit', { 'retry-after': '47' }),
    );
    expect(limited.kind).toBe('rate-limit');
    expect(limited.retryable).toBe(true);
    expect(limited.retryAfterSec).toBe(47);

    const denied = describeHostError(octokitError(403, 'Resource not accessible by integration'));
    expect(denied.kind).toBe('permission');
    expect(denied.retryable).toBe(false);
  });

  it('derives a wait from x-ratelimit-reset when the host sends no Retry-After', () => {
    const resetIn60 = Math.floor(Date.now() / 1000) + 60;
    const info = describeHostError(
      octokitError(403, 'API rate limit exceeded', { 'x-ratelimit-reset': String(resetIn60) }),
    );
    expect(info.kind).toBe('rate-limit');
    expect(info.retryAfterSec).toBeGreaterThan(50);
    expect(info.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('treats 404 as access-or-missing, since hosts answer "no write access" with 404', () => {
    const info = describeHostError(octokitError(404, 'Not Found'));
    expect(info.kind).toBe('not-found');
    expect(info.retryable).toBe(false);
    expect(info.hint).toMatch(/access/i);
  });

  it('recognises the fast-forward race as a conflict a retry does fix', () => {
    const info = describeHostError(octokitError(422, 'Update is not a fast forward'));
    expect(info.kind).toBe('conflict');
    expect(info.retryable).toBe(true);
  });

  it('keeps other 422s non-retryable — resending the same body gets the same answer', () => {
    const info = describeHostError(octokitError(422, 'Validation Failed'));
    expect(info.kind).toBe('invalid');
    expect(info.retryable).toBe(false);
  });

  it('classifies a dropped connection (no status) as network', () => {
    const info = describeHostError(new TypeError('Failed to fetch'));
    expect(info.kind).toBe('network');
    expect(info.retryable).toBe(true);
    expect(info.status).toBeUndefined();
  });

  it('treats 5xx as a transient host problem', () => {
    expect(describeHostError(octokitError(500, 'Server Error')).kind).toBe('server');
    expect(describeHostError(octokitError(502, 'Bad gateway')).retryable).toBe(true);
  });

  it('surfaces the request id from either header spelling', () => {
    expect(
      describeHostError(octokitError(500, 'boom', { 'x-github-request-id': 'ABC:123' })).requestId,
    ).toBe('ABC:123');
    expect(describeHostError(fetchAdapterError(500, 'boom', { 'x-request-id': 'req-9' })).requestId).toBe('req-9');
  });

  it('reads a `Headers` object as happily as a plain record (Gitea/GitLab adapters)', () => {
    const info = describeHostError(fetchAdapterError(403, 'API rate limit exceeded', { 'retry-after': '12' }));
    expect(info.kind).toBe('rate-limit');
    expect(info.retryAfterSec).toBe(12);
  });

  it('prefers the host body message over the client’s generic one, and folds in field errors', () => {
    const err = octokitError(422, 'ignored', {}, {
      message: 'Validation Failed',
      errors: [{ resource: 'Blob', code: 'too_large', message: 'blob is too large' }],
    });
    expect(describeHostError(err).message).toBe('Validation Failed — blob is too large');
  });

  it('never throws on an exotic value', () => {
    expect(describeHostError(undefined).kind).toBe('unknown');
    expect(describeHostError('just a string').message).toBe('just a string');
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => describeHostError(circular)).not.toThrow();
  });
});

describe('redactSecrets', () => {
  it('strips token shapes from every host we support', () => {
    const text = [
      'ghp_0123456789abcdefghijABCDEFGHIJ',
      'github_pat_11ABCDEFG0abcdefghijklmnop',
      'glpat-abcdefghijklmnopqrst',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload',
      'https://example.com/cb?access_token=secret-value&state=x',
    ].join(' ');
    const redacted = redactSecrets(text);
    expect(redacted).not.toMatch(/ghp_|github_pat_|glpat-|eyJhbGciOiJIUzI1NiJ9|secret-value/);
    expect(redacted).toContain('[redacted]');
  });

  it('leaves commit SHAs alone — they are the most useful thing in a git CMS log', () => {
    const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    expect(redactSecrets(`commit ${sha} landed`)).toContain(sha);
  });

  it('redacts a token carried inside an error message', () => {
    const err = new Error('request failed with token ghp_0123456789abcdefghijABCDEFGHIJ');
    expect(describeHostError(err).message).not.toContain('ghp_');
  });
});
