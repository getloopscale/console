// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { cardMode, periodDelta, costByPeriod, deltaTooSparse, MIN_BUCKETS_FOR_DELTA } from './overview-metrics';

describe('costByPeriod', () => {
  it('sums cost per period in chronological order (range-scoped, single source)', () => {
    const rows = [
      { periodStart: '2026-07-07T01:00:00Z', model: 'a', totalTokens: 10, costUsd: 0.02 },
      { periodStart: '2026-07-07T00:00:00Z', model: 'a', totalTokens: 10, costUsd: 0.05 },
      { periodStart: '2026-07-07T00:00:00Z', model: 'b', totalTokens: 10, costUsd: 0.01 },
    ];
    // period 00:00 = 0.05 + 0.01 = 0.06; period 01:00 = 0.02 — chronological order
    const out = costByPeriod(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(0.06, 6);
    expect(out[1]).toBeCloseTo(0.02, 6);
  });
  it('empty rows → empty (no fabricated bucket)', () => {
    expect(costByPeriod([])).toEqual([]);
  });
});

/**
 * M60 P0 T0.1 — the pure overview-analytics helpers. The delta is an honest half-vs-half
 * period-over-period computed from the fetched window; the load-bearing invariant is that a
 * division-by-zero / un-splittable / sparse window resolves to `na` — never `Infinity`/`NaN`
 * leaking to a tile (R3). `cardMode` is the width-adaptive-degradation threshold decision.
 */

describe('M60 periodDelta', () => {
  it('returns na on an un-splittable window ([] and [x])', () => {
    expect(periodDelta([]).na).toBe(true);
    expect(periodDelta([7]).na).toBe(true);
  });

  it('computes the half-vs-half percent (sum)', () => {
    // prev = 10+10 = 20, cur = 20+20 = 40 → +100%
    expect(periodDelta([10, 10, 20, 20], 'sum')).toEqual({ pct: 100, trend: 'up', na: false });
  });

  it('reports a drop to zero as -100% down', () => {
    expect(periodDelta([5, 0], 'sum')).toEqual({ pct: -100, trend: 'down', na: false });
  });

  it('yields na (not Infinity) when the previous half is zero and the current is positive', () => {
    const d = periodDelta([0, 5], 'sum');
    expect(d.na).toBe(true);
    expect(Number.isFinite(d.pct)).toBe(true); // never Infinity/NaN
  });

  it('reports an all-zero window as 0% neutral (computable, not na)', () => {
    expect(periodDelta([0, 0], 'sum')).toEqual({ pct: 0, trend: 'neutral', na: false });
  });

  it('averages rate/latency metrics with agg="mean"', () => {
    // prev = mean(10,10)=10, cur = mean(30,30)=30 → +200%
    expect(periodDelta([10, 10, 30, 30], 'mean')).toEqual({ pct: 200, trend: 'up', na: false });
  });

  it('reports a decrease as down', () => {
    expect(periodDelta([20, 20, 10, 10], 'sum').trend).toBe('down');
  });

  it('does NOT fabricate a delta on a FLAT odd-length window (equal halves, middle dropped) — H1', () => {
    // 7 equal buckets (a 7d range) → prev == cur → exactly 0%, not a fabricated +33%.
    expect(periodDelta([10, 10, 10, 10, 10, 10, 10], 'sum')).toEqual({ pct: 0, trend: 'neutral', na: false });
    expect(periodDelta([10, 10, 10, 10, 10], 'sum').pct).toBe(0);
  });

  it('yields na (not "NaN%") on a malformed NaN bucket — M1', () => {
    const d = periodDelta([Number.NaN, 5], 'sum');
    expect(d.na).toBe(true);
    expect(Number.isNaN(d.pct)).toBe(false);
  });
});

describe('M60 cardMode', () => {
  it('maps width to the three degradation modes', () => {
    expect([cardMode(300), cardMode(180), cardMode(120)]).toEqual(['full', 'no-delta', 'icon-only']);
  });

  it('respects the exact thresholds (240 / 160 boundaries)', () => {
    expect(cardMode(240)).toBe('full');
    expect(cardMode(239)).toBe('no-delta');
    expect(cardMode(160)).toBe('no-delta');
    expect(cardMode(159)).toBe('icon-only');
  });
});

describe('M76 deltaTooSparse (O-1 small-N delta suppression)', () => {
  it('is true below the documented bucket threshold, false at/above it', () => {
    expect(MIN_BUCKETS_FOR_DELTA).toBe(6);
    expect(deltaTooSparse(4)).toBe(true); // 3-4 buckets → the ±% is noise (audit O-1)
    expect(deltaTooSparse(5)).toBe(true);
    expect(deltaTooSparse(6)).toBe(false); // enough buckets → a real delta
    expect(deltaTooSparse(24)).toBe(false);
  });
});
