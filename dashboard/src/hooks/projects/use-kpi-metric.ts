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
 *   - error_rate:  a ratio ×100 (already a percent, per loopscale#170 fix) → ×1
 */
export function useKpiMetric(
  projectName: string | undefined,
  signal: string,
  multiplier = 1,
): number | null {
  return useKpiReading(projectName, signal, multiplier).value;
}

/** The current value of a signal, and whether the API says its series is still being collected. */
export interface KpiReading {
  value: number | null;
  collecting: boolean;
}

/**
 * Like `useKpiMetric`, plus the `collecting` status the metrics endpoint answers while a series has
 * no points yet, so the screen can say so instead of showing a bare dash.
 */
export function useKpiReading(
  projectName: string | undefined,
  signal: string,
  multiplier = 1,
): KpiReading {
  const { data, status } = useMetricsRange(projectName, { signal, range: '1h' });
  const collecting = status === 'collecting';
  if (!data || data.length === 0) return { value: null, collecting };
  const last = data[data.length - 1];
  if (typeof last?.v !== 'number' || Number.isNaN(last.v)) return { value: null, collecting };
  return { value: last.v * multiplier, collecting: false };
}
