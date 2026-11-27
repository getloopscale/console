import { describe, expect, it } from 'vitest';
import type { Build } from '@/lib/api/types';
import { deploymentRefetchInterval } from './use-deployment';

const build = (status: string) => ({ status }) as unknown as Build;

// The detail page read a build once. A redeploy that reuses its image finishes in seconds,
// before the page subscribes to the stream, and the header kept "Running" and "Cancel build"
// on a build the API already answered as SUCCEEDED.
describe('deploymentRefetchInterval', () => {
  it('keeps reading a build that has not finished', () => {
    for (const status of ['QUEUED', 'RUNNING', 'CANCELLING', 'running']) {
      expect(deploymentRefetchInterval(build(status))).toBe(5000);
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
