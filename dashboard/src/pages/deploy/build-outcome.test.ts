// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildNeverDeployed, buildOutcome, deployFailed } from './build-outcome';

// A build whose image was built and whose rollout failed was shown as "Succeeded": the screen
// had only the build status to read (getloopscale/loop-runtime#135).
describe('buildOutcome', () => {
  it('reads a built image whose deploy failed as failed', () => {
    expect(buildOutcome({ status: 'SUCCEEDED' as never, deploy_status: 'failed' })).toBe('failed');
    expect(deployFailed({ status: 'SUCCEEDED' as never, deploy_status: 'failed' })).toBe(true);
    expect(buildOutcome({ status: 'succeeded', deploy_status: 'rollback_failed' })).toBe('failed');
  });

  it.each(['succeeded', 'superseded', 'in_progress', 'rolled_back', 'cancelled', 'archived', undefined])(
    'keeps the build status when the deploy status is %s',
    (deployStatus) => {
      expect(buildOutcome({ status: 'succeeded', deploy_status: deployStatus })).toBe('succeeded');
      expect(deployFailed({ status: 'succeeded', deploy_status: deployStatus })).toBe(false);
    },
  );

  it('does not call a build that itself failed a failed deploy', () => {
    expect(buildOutcome({ status: 'failed', deploy_status: undefined })).toBe('failed');
    expect(deployFailed({ status: 'failed', deploy_status: undefined })).toBe(false);
  });

  it('leaves a running build running whatever an old release says', () => {
    expect(buildOutcome({ status: 'RUNNING' as never, deploy_status: 'failed' })).toBe('running');
  });
});

describe('buildNeverDeployed', () => {
  it.each([
    ['failed', 'succeeded'],
    ['canceled', undefined],
    ['running', 'FAILED'],
    ['queued', 'cancelled'],
  ])('is true for a %s timeline with a %s build', (overall, status) => {
    expect(buildNeverDeployed(overall, status)).toBe(true);
  });

  it.each([
    ['running', 'running'],
    ['live', 'SUCCEEDED'],
    ['queued', undefined],
  ])('is false for a %s timeline with a %s build', (overall, status) => {
    expect(buildNeverDeployed(overall, status)).toBe(false);
  });
});
