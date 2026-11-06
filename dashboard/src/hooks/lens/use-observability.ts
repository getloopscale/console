import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

/**
 * The three bucket shapes the observability endpoint returns.
 *
 * Declared here, and `pages/lens/components/lens-series.ts` imports them — same move `ScoreBucket`
 * made, for the same two reasons. They are wire shapes, so they belong with the request that
 * produces them; and `src/hooks` may not import from `src/pages` (the layer direction
 * `eslint.config.js` enforces since B-070), so a response type living under `pages/` makes the
 * hook untypeable. The rule catching that is the rule working.
 */
export interface TrafficBucket {
  periodStart: string;
  traceCount: number;
  errorCount: number;
  errorRate: number;
}

export interface LatencyBucket {
  periodStart: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface ModelBucket {
  periodStart: string;
  model: string;
  totalTokens: number;
  costUsd: number;
}

export interface ObservabilityResult {
  range?: string;
  traffic: TrafficBucket[];
  latency: LatencyBucket[];
  tokensByModel: ModelBucket[];
}

/** The ranges theo-lens whitelists. Anything else is a 400. */
export const OBSERVABILITY_RANGES = ['1h', '24h', '7d', '30d'] as const;
export type ObservabilityRange = (typeof OBSERVABILITY_RANGES)[number];

/**
 * Traffic, latency and token usage over a range.
 *
 * The range is part of the cache key for the reason every windowed read in this feature states:
 * without it the chart shows one period's numbers under another period's label.
 */
export function useObservability(range: ObservabilityRange) {
  return useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/observability', range] as const,
    queryFn: () =>
      cloudFetch<ObservabilityResult>(
        `/v1/dashboard/lens/observability?range=${range}`,
        {},
        { throwOnError: true },
      ),
  });
}
