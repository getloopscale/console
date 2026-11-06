import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

export interface MemoryMetrics {
  total_memories: number;
  retrieval_api_usage: number;
  add_events: number;
  entity_count: number;
}

const metricsQueryKey = ['cloud', '/v1/dashboard/memory/metrics'] as const;

/**
 * The memory KPI figures.
 *
 * B-244 — the page built this and its key, and both `throwOnError` and the zero fallback carry
 * reasoning worth preserving verbatim rather than re-deriving:
 *
 * `throwOnError` opts a non-2xx into `isError` so the error Alert shows, instead of resolving to
 * `null` and masking an outage as fabricated zeros (decisão D2 do plano
 * dashboard-memory-error-surfacing, T1.3).
 *
 * The zero fallback is for a successful-but-empty 2xx, so the dashboard never renders NaN. It is
 * safe ONLY because of the line above it: on error the KPI strip is not rendered at all, so these
 * zeros can never stand in for an outage. The two decisions are one decision, and separating them
 * — keeping the fallback while dropping the contract — is exactly how a screen comes to report
 * "0 memories" for a service that is down.
 */
export const ZERO_METRICS: MemoryMetrics = {
  total_memories: 0,
  retrieval_api_usage: 0,
  add_events: 0,
  entity_count: 0,
};

export function useMemoryMetrics() {
  return useQuery({
    queryKey: metricsQueryKey,
    queryFn: () =>
      cloudFetch<MemoryMetrics>('/v1/dashboard/memory/metrics', {}, { throwOnError: true }),
  });
}

/**
 * The Refresh button's action.
 *
 * Exposed here rather than leaving the page to invalidate by hand: the key is this module's, and a
 * caller repeating the tuple is a caller that can get it wrong. This is the smaller sibling of the
 * key-drift the sessions and observability migrations closed.
 */
export function useRefreshMemoryMetrics() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: metricsQueryKey });
  };
}
