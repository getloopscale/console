/**
 * M51 — pure mappers from theo-lens's observability series (already bucketed server-side) to
 * `MetricTrendChart` series. Deterministic + unit-tested (no DOM). The by-model pivot collapses
 * high-cardinality models into an "Others" series (opik convergence) so the line count stays legible.
 */
import type { TrendSeries } from './metric-trend-chart';

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

// A fixed, colorblind-conscious palette; series index maps into it (wraps for safety).
const PALETTE = ['#6366f1', '#f59e0b', '#22c55e', '#06b6d4', '#a855f7', '#ec4899'];
const ERROR_COLOR = '#ef4444';
const OTHERS_COLOR = '#94a3b8';

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function throughputSeries(traffic: TrafficBucket[]): TrendSeries[] {
  return [{ name: 'traces', color: PALETTE[0], points: traffic.map((t, x) => ({ x, y: t.traceCount })) }];
}

/** Error-rate as a %-line straight from the pre-computed `errorRate` (opik parity — no re-derivation). */
export function errorRateSeries(traffic: TrafficBucket[]): TrendSeries[] {
  return [{ name: 'error %', color: ERROR_COLOR, points: traffic.map((t, x) => ({ x, y: round3(t.errorRate * 100) })) }];
}

/** p50/p95/p99 overlaid on a shared ms axis (phoenix/opik "together" convergence). */
export function latencySeries(latency: LatencyBucket[]): TrendSeries[] {
  return [
    { name: 'p50', color: PALETTE[0], points: latency.map((l, x) => ({ x, y: l.p50Ms })) },
    { name: 'p95', color: PALETTE[1], points: latency.map((l, x) => ({ x, y: l.p95Ms })) },
    { name: 'p99', color: ERROR_COLOR, points: latency.map((l, x) => ({ x, y: l.p99Ms })) },
  ];
}

/**
 * Pivot the long by-model rows to one series per model over the shared bucket axis, summing the
 * value returned by `valueOf`. Beyond `topN` models (ranked by that value) collapse into a single
 * "Others" series. Shared by cost-by-model and tokens-by-model so the two never diverge (#178).
 */
function byModelSeries(rows: ModelBucket[], valueOf: (r: ModelBucket) => number, topN: number): TrendSeries[] {
  if (rows.length === 0) return [];
  const periods = Array.from(new Set(rows.map((r) => r.periodStart))).sort();
  const idx = new Map(periods.map((p, i) => [p, i]));

  const totalByModel = new Map<string, number>();
  for (const r of rows) totalByModel.set(r.model, (totalByModel.get(r.model) ?? 0) + valueOf(r));
  const top = [...totalByModel.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([m]) => m);
  const topSet = new Set(top);

  const zero = () => periods.map(() => 0);
  const byKey = new Map<string, number[]>();
  for (const m of top) byKey.set(m, zero());
  let hasOthers = false;
  for (const r of rows) {
    const key = topSet.has(r.model) ? r.model : 'Others';
    if (key === 'Others' && !byKey.has('Others')) {
      byKey.set('Others', zero());
      hasOthers = true;
    }
    byKey.get(key)![idx.get(r.periodStart)!] += valueOf(r);
  }

  const out: TrendSeries[] = top.map((m, i) => ({
    name: m,
    color: PALETTE[i % PALETTE.length],
    points: byKey.get(m)!.map((y, x) => ({ x, y: round3(y) })),
  }));
  if (hasOthers) {
    out.push({ name: 'Others', color: OTHERS_COLOR, points: byKey.get('Others')!.map((y, x) => ({ x, y: round3(y) })) });
  }
  return out;
}

/**
 * Cost by model: one series per model over the shared bucket axis, summing `costUsd`.
 * Beyond `topN` models (ranked by total cost) collapse into a single "Others" series.
 */
export function costByModelSeries(rows: ModelBucket[], topN = 5): TrendSeries[] {
  return byModelSeries(rows, (r) => r.costUsd, topN);
}

/**
 * Tokens by model: one series per model over the shared bucket axis, summing `totalTokens`.
 * The tokens trend must plot tokens — NOT cost (issue usetheodev/theo-cloud#178, where the
 * "Tokens by model" widget routed through `costByModelSeries` and plotted dollars).
 */
export function tokensByModelSeries(rows: ModelBucket[], topN = 5): TrendSeries[] {
  return byModelSeries(rows, (r) => r.totalTokens, topN);
}
