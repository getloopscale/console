/** One answer of `GET /v1/sandboxes/{id}/metrics`. */
export interface MetricsSample {
  at: string;
  /** CPU time used since the sandbox started. */
  cpu_usage_ns: number;
  memory_used_bytes: number;
  memory_limit_bytes: number;
  /** Absent when the sandbox cannot report its workspace, as while it is paused. */
  disk_used_bytes?: number;
  disk_limit_bytes?: number;
}

/** A value at a moment, in unix seconds, as the resource chart takes it. */
interface SeriesPoint {
  t: number;
  v: number;
}

/** How many samples the page keeps. At one every 3 seconds that is 10 minutes. */
const SERIES_LIMIT = 200;

/** The series with one more sample, without the oldest ones past `limit`. */
export function appendSample(series: MetricsSample[], sample: MetricsSample, limit = SERIES_LIMIT): MetricsSample[] {
  if (series[series.length - 1]?.at === sample.at) return series;
  return [...series, sample].slice(-limit);
}

const seconds = (iso: string) => Date.parse(iso) / 1000;

/**
 * The cores in use between each pair of samples. The API answers a counter of
 * CPU time, so the rate is the difference divided by the time between the two.
 */
export function cpuPoints(series: MetricsSample[]): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (let i = 1; i < series.length; i++) {
    const elapsed = seconds(series[i].at) - seconds(series[i - 1].at);
    if (elapsed <= 0) continue;
    const used = Math.max(0, series[i].cpu_usage_ns - series[i - 1].cpu_usage_ns) / 1e9;
    points.push({ t: seconds(series[i].at), v: used / elapsed });
  }
  return points;
}

/** One value of every sample as chart points. Samples without the value are left out. */
export function valuePoints(series: MetricsSample[], value: (s: MetricsSample) => number | undefined): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const s of series) {
    const v = value(s);
    if (v !== undefined) points.push({ t: seconds(s.at), v });
  }
  return points;
}
