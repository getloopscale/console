// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Build } from '@/lib/api/types';
import { deploymentRefetchInterval } from './deployment-refetch-interval';

const build = (status: string, deploy_status?: string) => ({ status, deploy_status }) as unknown as Build;

// The detail page read a build once. A redeploy that reuses its image finishes in seconds,
// before the page subscribes to the stream, and the header kept "Running" and "Cancel build"
// on a build the API already answered as SUCCEEDED.
describe('deploymentRefetchInterval', () => {
  // The engine holds a build in RELEASING while the release rolls out. Staging showed that
  // status between RUNNING and SUCCEEDED, and a page that stopped reading there would stay on it.
  it('keeps reading a build that is releasing, or in a status it does not know', () => {
    for (const status of ['RELEASING', 'releasing', 'SOMETHING_NEW']) {
      expect(deploymentRefetchInterval(build(status))).toBe(5000);
    }
  });

  it('keeps reading a build that has not finished', () => {
    for (const status of ['QUEUED', 'RUNNING', 'CANCELLING', 'running']) {
      expect(deploymentRefetchInterval(build(status))).toBe(5000);
    }
  });

  // Staging answered SUCCEEDED with deploy_status in_progress for the whole rollout. The page
  // stopped reading there and its timeline flipped between "Unknown" and "Deploying" (#613).
  it('keeps reading a succeeded build while its deploy is still moving', () => {
    for (const deployStatus of ['in_progress', 'rolling_back']) {
      expect(deploymentRefetchInterval(build('SUCCEEDED', deployStatus))).toBe(5000);
    }
  });

  it('stops once the deploy of a succeeded build settled, or when there is none', () => {
    for (const deployStatus of ['succeeded', 'failed', 'superseded', 'rolled_back', 'archived', undefined]) {
      expect(deploymentRefetchInterval(build('SUCCEEDED', deployStatus))).toBe(false);
    }
  });

  it('stops once the build reached an end state', () => {
    for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED', 'succeeded']) {
      expect(deploymentRefetchInterval(build(status))).toBe(false);
    }
  });

  it('does not poll before the first answer or for a build that does not exist', () => {
    expect(deploymentRefetchInterval(undefined)).toBe(false);
    expect(deploymentRefetchInterval(null)).toBe(false);
  });
});
