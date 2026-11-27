import type { Build } from '@/lib/api/types';

const IN_FLIGHT_STATUSES = new Set(['queued', 'running', 'cancelling']);
const IN_FLIGHT_REFETCH_MS = 5000;

/**
 * How often to read a build again: every five seconds while it has not finished, never once
 * it has. The stream of the detail page does not replace this read. A build that reuses its
 * image ends before the page subscribes, and nothing else updates the status in the header.
 */
export function deploymentRefetchInterval(build: Build | null | undefined): number | false {
  if (!build) return false;
  return IN_FLIGHT_STATUSES.has(String(build.status).toLowerCase()) ? IN_FLIGHT_REFETCH_MS : false;
}
