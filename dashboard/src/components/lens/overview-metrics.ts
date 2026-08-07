import type { LatencyBucket, ModelBucket, TrafficBucket } from './lens-series';

/**
 * M60 P0 — pure overview-analytics helpers (dependency-free leaf; ADR D2/D3). `periodDelta` computes
 * an honest period-over-period delta from the ALREADY-FETCHED M51 window (no BFF change): it splits
 * the window into two equal halves and compares `aggregate(second half)` vs `aggregate(first half)`.
 * Division-by-zero / un-splittable / sparse windows resolve to `na` — never `Infinity`/`NaN` leaking
 * to a tile (Opik `MetricsSummary` convention). `cardMode` is the width-adaptive-degradation decision.
 * Pure + total; no React, no `cloudFetch`.
 */

export type DeltaTrend = 'up' | 'down' | 'neutral';
export interface Delta {
  pct: number;
  trend: DeltaTrend;
  na: boolean;
}

const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);
const mean = (ns: number[]): number => (ns.length === 0 ? 0 : sum(ns) / ns.length);

/**
 * Half-vs-half period-over-period delta over the fetched window. `agg` = `sum` for count/cost metrics,
 * `mean` for rate/latency metrics. Fewer than 2 buckets → `na` (un-splittable). `prev===0 && cur>0`
 * → `na` (a % change from zero is undefined — shown as "N/A", never `Infinity`).
 */
export function periodDelta(values: number[], agg: 'sum' | 'mean' = 'sum'): Delta {
  if (values.length < 2) return { pct: 0, trend: 'neutral', na: true };
  // EQUAL halves: on an odd-length window the middle bucket is EXCLUDED so `prev` and `cur` span the
  // same number of buckets — otherwise a flat series would report a fabricated delta (the extra bucket
  // would inflate one half). prev = first `mid`, cur = last `mid`.
  const mid = Math.floor(values.length / 2);
  const aggregate = agg === 'mean' ? mean : sum;
  const prev = aggregate(values.slice(0, mid));
  const cur = aggregate(values.slice(values.length - mid));

  // A malformed bucket (NaN/±Infinity) never leaks a "NaN%"/"Infinity%" delta to a tile → N/A.
  if (!Number.isFinite(prev) || !Number.isFinite(cur)) return { pct: 0, trend: 'neutral', na: true };
  if (prev === 0 && cur === 0) return { pct: 0, trend: 'neutral', na: false };
  if (prev === 0) return { pct: 0, trend: 'neutral', na: true }; // cur>0 vs 0 → undefined % → N/A
  if (cur === 0) return { pct: -100, trend: 'down', na: false };

  const pct = ((cur - prev) / prev) * 100;
  const trend: DeltaTrend = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral';
  return { pct, trend, na: false };
}

/**
 * M76 (O-1) — a period-over-period delta needs enough buckets to be meaningful. Below this, a bold ±%
 * arrow over-dramatizes a tiny sample (3-4 buckets is noise, not signal). The KPI strip suppresses the
 * delta (shows an honest em-dash / "too sparse" hint) when the window has fewer buckets. A single
 * documented constant, tunable from real data later. Kept separate from `periodDelta` (which stays the
 * pure math, valid for any ≥2 buckets) — this is a *presentation-honesty* decision, not a math one.
 */
export const MIN_BUCKETS_FOR_DELTA = 6;
export function deltaTooSparse(bucketCount: number): boolean {
  return bucketCount < MIN_BUCKETS_FOR_DELTA;
}

export type CardMode = 'full' | 'no-delta' | 'icon-only';

const CARD_WIDTH_FULL = 240;
const CARD_WIDTH_NO_DELTA = 160;

/** Width-adaptive degradation: a wide tile shows everything, a narrow one drops the delta, then the label. */
export function cardMode(perCardWidth: number): CardMode {
  if (perCardWidth >= CARD_WIDTH_FULL) return 'full';
  if (perCardWidth >= CARD_WIDTH_NO_DELTA) return 'no-delta';
  return 'icon-only';
}

/** The per-metric value arrays the KPI strip + shared chart read from the M51 window (pure projections). */
export function tracesValues(traffic: TrafficBucket[]): number[] {
  return traffic.map((t) => t.traceCount);
}
export function errorRateValues(traffic: TrafficBucket[]): number[] {
  return traffic.map((t) => t.errorRate);
}
export function p95Values(latency: LatencyBucket[]): number[] {
  return latency.map((l) => l.p95Ms);
}

/**
 * Per-period total cost from the range-scoped by-model rows, in chronological period order. Lets the
 * Overview cost KPI + its sparkline share the SAME time window as the cost-by-model chart (both from
 * `tokensByModel`) instead of a separate all-time `/cost` fetch that disagreed on the window.
 */
export function costByPeriod(rows: ModelBucket[]): number[] {
  const byPeriod = new Map<string, number>();
  for (const r of rows) byPeriod.set(r.periodStart, (byPeriod.get(r.periodStart) ?? 0) + r.costUsd);
  return [...byPeriod.keys()].sort().map((p) => byPeriod.get(p)!);
}
