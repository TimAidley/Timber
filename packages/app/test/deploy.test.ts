import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '@timber/github';
import { deployState } from '../src/state/deploy.js';

function run(status: string, conclusion: string | null): WorkflowRun {
  return { status, conclusion, url: 'https://x/runs/1', headBranch: 'main', createdAt: '' };
}

describe('deployState', () => {
  it('shows nothing when there is no run', () => {
    expect(deployState(undefined)).toBe('none');
  });

  it('shows building while queued or in progress', () => {
    expect(deployState(run('queued', null))).toBe('building');
    expect(deployState(run('in_progress', null))).toBe('building');
  });

  it('shows published on a successful completed run', () => {
    expect(deployState(run('completed', 'success'))).toBe('published');
  });

  it('shows failed on a non-success completed run', () => {
    expect(deployState(run('completed', 'failure'))).toBe('failed');
    expect(deployState(run('completed', 'cancelled'))).toBe('failed');
  });
});
