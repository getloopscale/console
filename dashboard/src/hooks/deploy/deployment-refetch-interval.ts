import type { Build } from '@/lib/api/types';

// Every other status is a build still in progress: QUEUED, RUNNING, RELEASING, CANCELLING,
// and any status a newer engine adds.
const FINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
// The deploy of a build outlives the build: the image is done and the release still rolls out.
const MOVING_DEPLOY_STATUSES = new Set(['in_progress', 'rolling_back']);
const IN_FLIGHT_REFETCH_MS = 5000;

/**
 * How often to read a build again: every five seconds while the build or its deploy has not
 * finished, never once both have. The stream of the detail page does not replace this read. A build that reuses its
 * image ends before the page subscribes, and nothing else updates the status in the header.
 */
export function deploymentRefetchInterval(build: Build | null | undefined): number | false {
  if (!build) return false;
  if (!FINAL_STATUSES.has(String(build.status).toLowerCase())) return IN_FLIGHT_REFETCH_MS;
  return MOVING_DEPLOY_STATUSES.has(String(build.deploy_status ?? '').toLowerCase()) ? IN_FLIGHT_REFETCH_MS : false;
}
