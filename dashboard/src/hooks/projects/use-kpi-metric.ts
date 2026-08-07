import { useMetricsRange } from './use-metrics-range';

/**
 * useKpiMetric — J-18 KPI-strip current-value derivation.
 *
 * Fetches a short 1h range for one Prometheus signal via the metrics_proxy and
 * returns the LATEST datapoint's value × `multiplier` (the unit conversion the
 * KPI strip / SignalGrid formatter expects), or `null` when there is no data
 * (collecting / unreachable / no series). The "current value" of a signal is
 * the last point of the range.
 *
 * Multipliers (match the SignalGrid formatters):
 *   - uptime_24h:  avg_over_time(up) is 0..1 → ×100 → percent
 *   - p95_latency: histogram_quantile is seconds → ×1000 → ms
 *   - rps:         rate is already a per-second number → ×1
 *   - error_rate:  a ratio ×100 (already a percent, per theo#170 fix) → ×1
 */
export function useKpiMetric(
  projectName: string | undefined,
  env: string | undefined,
  signal: string,
  multiplier = 1,
): number | null {
  const { data } = useMetricsRange(projectName, env, { signal, range: '1h' });
  if (!data || data.length === 0) return null;
  const last = data[data.length - 1];
  if (typeof last?.v !== 'number' || Number.isNaN(last.v)) return null;
  return last.v * multiplier;
}
