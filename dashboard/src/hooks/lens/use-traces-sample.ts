import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

/**
 * B-024 (class) — the histogram reads a SAMPLE of traces, and traces grow without end. Without a
 * ceiling the component downloaded the whole list to derive twelve bars.
 *
 * 500 is enough for the shape of the distribution to stabilise across twelve bins. The screen
 * states the sample size next to the chart: a histogram over a sample that does not declare its n
 * invites the wrong reading.
 */
export const DURATION_SAMPLE = 500;

/**
 * A bounded sample of the most recent traces, for derived charts.
 *
 * Generic over the trace shape: `Trace` is owned by `pages/lens/traces/columns`, and `src/hooks`
 * may not import from `src/pages` (B-070). The caller supplies the type it already owns.
 */
export function useTracesSample<T>() {
  return useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/traces', 'dashboards-duration'] as const,
    queryFn: () =>
      cloudFetch<{ traces: T[] }>(
        `/v1/dashboard/lens/traces?limit=${DURATION_SAMPLE}`,
        {},
        { throwOnError: true },
      ),
  });
}
