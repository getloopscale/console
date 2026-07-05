import { useQuery } from '@tanstack/react-query';

import { engineFetch } from '@/lib/api';

/**
 * use-build-stats (J-06 D2) — the tenant-scoped deploys aggregate that feeds the
 * Overview "Deploys (7d)" KPI + the deploys-by-day sparkline. Consumes the engine
 * endpoint GET /api/v1/builds/stats?window={7d,30d,90d} (MEET-2026-07-03-003 D2),
 * which returns a dense, zero-filled, UTC-bucketed series server-side — the
 * client never re-aggregates.
 */
export type BuildStatsWindow = '7d' | '30d' | '90d';

export interface BuildStatsDay {
  date: string; // YYYY-MM-DD, UTC
  count: number;
}

interface BuildStatsResponse {
  window_days: number;
  timezone: string;
  by_day: BuildStatsDay[];
  last_7d_count: number;
  total_count: number;
}

export interface BuildStats {
  /** Deploys in the last 7 calendar days (derived server-side from the same series). */
  last7d: number;
  /** Dense, zero-filled by-day series for the sparkline. */
  byDay: BuildStatsDay[];
  total: number;
  loading: boolean;
  error: boolean;
}

export function useBuildStats(window: BuildStatsWindow = '30d'): BuildStats {
  const query = useQuery({
    queryKey: ['build-stats', window],
    queryFn: () => engineFetch<BuildStatsResponse>(`/api/v1/builds/stats?window=${window}`),
    staleTime: 60_000,
  });

  return {
    last7d: query.data?.last_7d_count ?? 0,
    byDay: query.data?.by_day ?? [],
    total: query.data?.total_count ?? 0,
    loading: query.isLoading,
    error: query.isError,
  };
}
