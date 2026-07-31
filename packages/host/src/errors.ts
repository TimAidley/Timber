/**
 * Host-error normalisation — the "why" behind a failed save (SPEC §11: *on
 * failure … show "unsaved" and retry with backoff*; that retry is only honest if
 * the editor can also say **what** failed).
 *
 * Every adapter throws a differently-shaped error — Octokit's `RequestError`
 * (`@timber/github`), the status-carrying `Error` the Gitea/GitLab adapters build,
 * a bare `TypeError` from a dropped connection. {@link describeHostError} collapses
 * all of them onto one small vocabulary so the UI can stay dumb: a short reason for
 * the badge, a hint naming the fix, and — crucially — whether a retry can plausibly
 * work at all. A 401 is not a transient blip: backing off and retrying forever is
 * exactly the "Save failed — retrying" that never resolves and never explains itself.
 *
 * Host-neutral and dependency-free, like the rest of this port: no DOM types, no
 * knowledge of which adapter produced the error.
 */

/** What went wrong, coarse enough for the UI to act on. */
export type HostErrorKind =
  /** Not (or no longer) authenticated — an expired/revoked token. Re-auth, don't retry. */
  | 'auth'
  /** Authenticated, but not allowed to do this — missing repo write access/scope. */
  | 'permission'
  /** The repo, branch or path isn't there (or is invisible to this token). */
  | 'not-found'
  /** Throttled by the host. A retry works, but only after waiting. */
  | 'rate-limit'
  /** The branch tip moved under us — a concurrent editor/tab. Retrying rebuilds on the new tip. */
  | 'conflict'
  /** The request body was too big (an unprocessed image, usually). */
  | 'too-large'
  /** The host rejected the request as malformed/invalid — retrying sends the same thing. */
  | 'invalid'
  /** Never reached the host: offline, DNS, CORS, a proxy eating the request. */
  | 'network'
  /** The host is broken or degraded (5xx). Usually transient. */
  | 'server'
  /** Unrecognised — surfaced verbatim so the log still carries the raw message. */
  | 'unknown';

export interface HostErrorInfo {
  kind: HostErrorKind;
  /** Short phrase for an inline status line, e.g. `signed out`. Lowercase, no period. */
  reason: string;
  /** One sentence naming the fix, for a tooltip/panel. */
  hint: string;
  /** Whether retrying *unchanged* could plausibly succeed (false ⇒ needs the user). */
  retryable: boolean;
  /** The host's own message, secrets redacted. */
  message: string;
  /** HTTP status, when the failure reached the host. */
  status?: number;
  /** The host's request id (`x-github-request-id` / `x-request-id`) — gold in a bug report. */
  requestId?: string;
  /** How long the host asked us to wait, when it said so. */
  retryAfterSec?: number;
}

/**
 * Token shapes that must never reach a log line, a copied diagnostics dump, or the
 * screen. Deliberately *not* a bare 40-hex rule: that would also redact every commit
 * SHA, which is the most useful thing in a git-backed CMS's logs.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g, // GitHub classic PAT / OAuth / user / server / refresh
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g, // GitHub fine-grained PAT
  /\bglpat-[A-Za-z0-9_-]{16,}/g, // GitLab PAT
  /\b(?:Bearer|token)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, // Authorization header values
  /\b(?:access_token|refresh_token|private_token|client_secret|code_verifier)=[^&\s"']+/gi,
];

/** Replace anything token-shaped with `[redacted]`. Safe to call on any string. */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((s, re) => s.replace(re, '[redacted]'), text);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * Read one response header from whatever the adapter attached: a `Headers`-like object
 * (Gitea/GitLab pass the real `Response.headers`) or Octokit's plain lowercase record.
 * Duck-typed because this package carries no DOM lib.
 */
function headerOf(err: unknown, name: string): string | undefined {
  const response = asRecord(asRecord(err)?.['response']);
  const headers = response?.['headers'];
  if (!headers) return undefined;
  const getter = asRecord(headers)?.['get'];
  if (typeof getter === 'function') {
    const value = (getter as (n: string) => unknown).call(headers, name);
    return typeof value === 'string' ? value : undefined;
  }
  const record = asRecord(headers);
  const value = record?.[name] ?? record?.[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}

function statusOf(err: unknown): number | undefined {
  const e = asRecord(err);
  const direct = e?.['status'];
  if (typeof direct === 'number') return direct;
  const nested = asRecord(e?.['response'])?.['status'];
  return typeof nested === 'number' ? nested : undefined;
}

/**
 * The most specific message available: the host's JSON body beats the generic
 * "HTTP 422" the client threw, and GitHub's per-field `errors[]` beats both.
 */
function messageOf(err: unknown): string {
  const e = asRecord(err);
  const data = asRecord(asRecord(e?.['response'])?.['data']);
  const parts: string[] = [];
  const top = data?.['message'];
  if (typeof top === 'string' && top) parts.push(top);
  const errors = data?.['errors'];
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      const detail = asRecord(entry)?.['message'] ?? asRecord(entry)?.['code'];
      if (typeof detail === 'string' && detail) parts.push(detail);
    }
  }
  if (parts.length === 0) {
    const own = e?.['message'];
    if (typeof own === 'string' && own) parts.push(own);
  }
  return parts.length > 0 ? parts.join(' — ') : String(err);
}

function retryAfterOf(err: unknown, rateLimited: boolean): number | undefined {
  const retryAfter = Number(headerOf(err, 'retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter);
  if (!rateLimited) return undefined;
  // GitHub's primary rate limit reports an absolute reset instead of a delay.
  const reset = Number(headerOf(err, 'x-ratelimit-reset'));
  if (!Number.isFinite(reset) || reset <= 0) return undefined;
  return Math.max(0, Math.ceil(reset - Date.now() / 1000));
}

/** A request that never reached the host (offline, DNS, CORS, blocked by a proxy). */
function looksLikeNetworkFailure(err: unknown, message: string): boolean {
  if (statusOf(err) !== undefined) return false;
  if (err instanceof TypeError) return true; // `fetch` rejects with TypeError
  return /failed to fetch|network(?:\s|error)|load failed|err_|connection|socket|timed? ?out|aborted/i.test(
    message,
  );
}

interface Verdict {
  kind: HostErrorKind;
  reason: string;
  hint: string;
  retryable: boolean;
}

function classify(status: number | undefined, message: string, err: unknown): Verdict {
  if (status === undefined) {
    if (looksLikeNetworkFailure(err, message)) {
      return {
        kind: 'network',
        reason: 'no connection to the host',
        hint: 'Your changes are safe on this device. Saving resumes when the connection is back.',
        retryable: true,
      };
    }
    return { kind: 'unknown', reason: 'unexpected error', hint: 'See Diagnostics for the full error.', retryable: true };
  }

  // GitHub answers "your token can't write here" with 404, not 403, so both land on
  // the same practical advice: it's access, not a typo in the repo name.
  const rateLimited = /rate limit|abuse detection|secondary rate/i.test(message);

  if (status === 401) {
    return {
      kind: 'auth',
      reason: 'signed out',
      hint: 'Your session expired or the token was revoked. Sign in again — retrying cannot fix this.',
      retryable: false,
    };
  }
  if (status === 403 && rateLimited) {
    return {
      kind: 'rate-limit',
      reason: 'rate limited by the host',
      hint: 'Too many requests in a short window. Saving resumes automatically once the limit resets.',
      retryable: true,
    };
  }
  if (status === 403) {
    return {
      kind: 'permission',
      reason: 'no write access',
      hint: 'This account/token cannot write to the repo. Check the token has Contents: write on it.',
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      kind: 'not-found',
      reason: 'repo or branch not found',
      hint: 'The repo, branch or file is missing — or the token lacks access (hosts report that as 404 too).',
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      kind: 'rate-limit',
      reason: 'rate limited by the host',
      hint: 'Too many requests in a short window. Saving resumes automatically once the limit resets.',
      retryable: true,
    };
  }
  if (status === 409 || (status === 422 && /not a fast forward|reference (?:already exists|cannot be updated)/i.test(message))) {
    return {
      kind: 'conflict',
      reason: 'branch moved under us',
      hint: 'Another tab or device committed to the same branch. The next attempt rebuilds on the new tip.',
      retryable: true,
    };
  }
  if (status === 413) {
    return {
      kind: 'too-large',
      reason: 'change too large for the host',
      hint: 'Usually an oversized image. Remove or re-upload it so it goes through the resize pipeline.',
      retryable: false,
    };
  }
  if (status === 422 || status === 400) {
    return {
      kind: 'invalid',
      reason: 'the host rejected the change',
      hint: 'The request was refused as invalid — retrying sends the same thing. See Diagnostics.',
      retryable: false,
    };
  }
  if (status === 408) {
    return { kind: 'network', reason: 'the host timed out', hint: 'A transient timeout — the next attempt should go through.', retryable: true };
  }
  if (status >= 500) {
    return {
      kind: 'server',
      reason: 'the host is having problems',
      hint: 'The git host returned a server error. This is usually transient; saving keeps retrying.',
      retryable: true,
    };
  }
  return { kind: 'unknown', reason: `unexpected error (${status})`, hint: 'See Diagnostics for the full error.', retryable: true };
}

/**
 * Normalise any thrown value into a {@link HostErrorInfo}. Never throws, never returns
 * a secret: the message is redacted before it leaves.
 */
export function describeHostError(err: unknown): HostErrorInfo {
  const status = statusOf(err);
  const message = redactSecrets(messageOf(err));
  const verdict = classify(status, message, err);
  const requestId = headerOf(err, 'x-github-request-id') ?? headerOf(err, 'x-request-id');
  const retryAfterSec = retryAfterOf(err, verdict.kind === 'rate-limit');
  return {
    ...verdict,
    message,
    ...(status !== undefined ? { status } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
  };
}

/** One-line summary for a status line: `signed out (401)`. */
export function summarizeHostError(info: HostErrorInfo): string {
  return info.status !== undefined ? `${info.reason} (${info.status})` : info.reason;
}
