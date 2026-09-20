import { RepoClient } from '@timber/github';
import { describe, expect, it } from 'vitest';
import { FakeGitHub } from '../src/index.js';

const TOKEN = 't';

/** A fake with an injectable clock so a deploy run's arc can be stepped through by hand. */
function setup(actions: { queuedMs: number; runMs: number }) {
  let now = Date.parse('2026-09-20T10:00:00Z');
  const fake = new FakeGitHub({ now: () => now });
  fake.addUser('alice', TOKEN);
  const repo = fake.addRepo({ owner: 'acme', repo: 'site', actions });
  const client = new RepoClient({
    owner: 'acme',
    repo: 'site',
    getToken: async () => TOKEN,
    fetchImpl: fake.fetch,
  });
  return { fake, repo, client, advance: (ms: number) => (now += ms) };
}

describe('FakeActions', () => {
  it('a push to main queues a deploy that runs and completes as the clock advances', async () => {
    const { repo, client, advance } = setup({ queuedMs: 1000, runMs: 4000 });
    await repo.writeFiles('main', { 'content/a.md': 'a' }, 'seed');

    let run = (await client.deploy.getLatestDeploy('main'))!;
    expect(run).toMatchObject({ status: 'queued', conclusion: null, headBranch: 'main' });
    expect(run.startedAt).toBeUndefined();
    expect(await client.deploy.getDeployProgress(run.id!)).toEqual({ phase: 'queued' });

    advance(1500);
    run = (await client.deploy.getLatestDeploy('main'))!;
    expect(run.status).toBe('in_progress');
    expect(run.startedAt).toBe('2026-09-20T10:00:01.000Z');
    expect(await client.deploy.getDeployProgress(run.id!)).toEqual({
      phase: 'running',
      label: 'Set up job',
    });

    advance(1500); // 2000ms into a 4000ms run: the middle of five steps
    expect(await client.deploy.getDeployProgress(run.id!)).toEqual({
      phase: 'running',
      label: 'Build the site',
    });

    advance(2500);
    run = (await client.deploy.getLatestDeploy('main'))!;
    expect(run).toMatchObject({ status: 'completed', conclusion: 'success' });
  });

  it('typical duration is learned from completed successful runs only', async () => {
    const { repo, client, advance } = setup({ queuedMs: 0, runMs: 3000 });
    expect(await client.deploy.getTypicalDeployDurationMs('main')).toBeUndefined();

    await repo.writeFiles('main', { 'content/a.md': 'a' });
    advance(10_000);
    repo.actions.failNextRun();
    await repo.writeFiles('main', { 'content/b.md': 'b' });
    advance(10_000);

    expect(await client.deploy.getTypicalDeployDurationMs('main')).toBe(3000);
    expect((await client.deploy.getLatestDeploy('main'))!.conclusion).toBe('failure');
  });

  it('workflow_dispatch re-runs the deploy for a ref', async () => {
    const { repo, client } = setup({ queuedMs: 0, runMs: 0 });
    await repo.writeFiles('main', { 'content/a.md': 'a' });
    const before = repo.actions.list().length;

    await client.deploy.triggerDeploy('main');

    expect(repo.actions.list().length).toBe(before + 1);
    expect(repo.actions.list()[0]).toMatchObject({
      event: 'workflow_dispatch',
      headBranch: 'main',
    });
  });

  it('a WIP-branch push does not trigger a deploy', async () => {
    const { repo } = setup({ queuedMs: 0, runMs: 0 });
    await repo.writeFiles('main', { 'content/a.md': 'a' });
    await repo.writeFiles('alice_wip', { 'content/b.md': 'b' });
    expect(repo.actions.list()).toHaveLength(1);
  });
});
