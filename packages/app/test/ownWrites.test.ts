import { describe, expect, it, vi } from 'vitest';
import type { HostProvider } from '@timber/host';
import { OwnWrites, recordingClient } from '../src/state/ownWrites.js';

/**
 * Telling our own commits from someone else's is the whole basis of the foreign-write
 * warning: miss one write path and the editor reports the user to themselves. Hence the
 * proxy — and hence a test that a *private-field-using* class survives being wrapped,
 * which is the trap a hand-written delegate falls into.
 */

class FakeClient {
  #secret = 'private-field';
  commits: string[] = [];

  readonly deploy = { getLatestDeploy: async () => undefined, triggerDeploy: async () => undefined };

  async commitFiles(input: { message: string }): Promise<{ sha: string }> {
    this.commits.push(input.message);
    return { sha: `sha-${this.commits.length}` };
  }

  async publishSquash(): Promise<{ sha: string }> {
    return { sha: 'squashed' };
  }

  /** Reads a private field — throws if the proxy lets `this` be the proxy. */
  async getDefaultBranch(): Promise<string> {
    return this.#secret;
  }
}

function wrap(): { client: HostProvider; fake: FakeClient; own: OwnWrites } {
  const fake = new FakeClient();
  const own = new OwnWrites();
  return { client: recordingClient(fake as unknown as HostProvider, own), fake, own };
}

describe('OwnWrites', () => {
  it('remembers recent shas and forgets old ones', () => {
    const own = new OwnWrites(3);
    for (const sha of ['a', 'b', 'c', 'd']) own.record(sha);

    expect(own.has('a')).toBe(false); // evicted
    expect(['b', 'c', 'd'].every((s) => own.has(s))).toBe(true);
    expect(own.latest()).toBe('d');
  });

  it('tolerates the same sha twice without consuming a slot', () => {
    const own = new OwnWrites(2);
    own.record('a');
    own.record('a');
    own.record('b');
    expect(own.has('a')).toBe(true);
    expect(own.has('b')).toBe(true);
  });
});

describe('recordingClient', () => {
  it('records the sha of every commit and publish', async () => {
    const { client, own } = wrap();

    const first = await client.commitFiles({ branch: 'me_wip', message: 'edit home', files: [] });
    expect(own.has(first.sha)).toBe(true);

    const published = await client.publishSquash({
      defaultBranch: 'main',
      wipBranch: 'me_wip',
      parentSha: 'p',
      wipTip: 'w',
      message: 'publish',
      strategy: 'clean',
      changes: [],
    });
    expect(own.has(published.sha)).toBe(true);
    expect(own.latest()).toBe(published.sha);
  });

  it('passes read calls straight through, private fields intact', async () => {
    const { client } = wrap();
    // A method bound to the proxy instead of the instance would throw on `#secret`.
    await expect(client.getDefaultBranch()).resolves.toBe('private-field');
  });

  it('leaves non-function properties (the deploy capability) alone', () => {
    const { client, fake } = wrap();
    expect(client.deploy).toBe(fake.deploy); // stable identity — React deps compare it
  });

  it('records nothing when a commit fails', async () => {
    const fake = new FakeClient();
    const own = new OwnWrites();
    vi.spyOn(fake, 'commitFiles').mockRejectedValue(new Error('boom'));
    const client = recordingClient(fake as unknown as HostProvider, own);

    await expect(client.commitFiles({ branch: 'me_wip', message: 'x', files: [] })).rejects.toThrow('boom');
    expect(own.latest()).toBeUndefined();
  });
});
