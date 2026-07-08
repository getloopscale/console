import { describe, it, expect } from 'vitest';
import {
  throughputSeries,
  errorRateSeries,
  latencySeries,
  costByModelSeries,
  tokensByModelSeries,
} from './lens-series';

describe('lens-series mappers (M51)', () => {
  it('throughputSeries: one series over the buckets', () => {
    const s = throughputSeries([
      { periodStart: 'a', traceCount: 8, errorCount: 2, errorRate: 0.25 },
      { periodStart: 'b', traceCount: 2, errorCount: 0, errorRate: 0 },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].points).toEqual([{ x: 0, y: 8 }, { x: 1, y: 2 }]);
  });

  it('errorRateSeries: a %-line straight from the pre-computed errorRate (no re-derivation)', () => {
    const s = errorRateSeries([{ periodStart: 'a', traceCount: 8, errorCount: 2, errorRate: 0.25 }]);
    expect(s[0].points).toEqual([{ x: 0, y: 25 }]);
  });

  it('latencySeries: p50/p95/p99 overlaid as three series', () => {
    const s = latencySeries([{ periodStart: 'a', p50Ms: 10, p95Ms: 90, p99Ms: 120 }]);
    expect(s.map((x) => x.name)).toEqual(['p50', 'p95', 'p99']);
    expect(s[2].points[0]).toEqual({ x: 0, y: 120 });
  });

  it('costByModelSeries: one series per model over a shared bucket axis', () => {
    const s = costByModelSeries([
      { periodStart: 'a', model: 'opus', totalTokens: 1, costUsd: 0.5 },
      { periodStart: 'b', model: 'opus', totalTokens: 1, costUsd: 0.7 },
      { periodStart: 'a', model: 'haiku', totalTokens: 1, costUsd: 0.1 },
    ]);
    const opus = s.find((x) => x.name === 'opus');
    const haiku = s.find((x) => x.name === 'haiku');
    expect(opus?.points).toEqual([{ x: 0, y: 0.5 }, { x: 1, y: 0.7 }]);
    expect(haiku?.points).toEqual([{ x: 0, y: 0.1 }, { x: 1, y: 0 }]); // zero-filled for the missing bucket
  });

  it('costByModelSeries: collapses beyond topN models into an "Others" series', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      periodStart: 'a',
      model: `m${i}`,
      totalTokens: 1,
      costUsd: 8 - i, // m0 most expensive … m7 least
    }));
    const s = costByModelSeries(rows, 5);
    expect(s.map((x) => x.name)).toContain('Others');
    // top 5 named models + 1 Others = 6 series
    expect(s).toHaveLength(6);
    // Others aggregates m5+m6+m7 = 3+2+1 = 6 in bucket 0
    expect(s.find((x) => x.name === 'Others')?.points[0].y).toBe(6);
  });

  it('costByModelSeries: empty input → no series', () => {
    expect(costByModelSeries([])).toEqual([]);
  });

  it('tokensByModelSeries: plots totalTokens, NOT cost (#178)', () => {
    const rows = [
      { periodStart: 'a', model: 'gpt-4', totalTokens: 900, costUsd: 0.03 },
      { periodStart: 'a', model: 'claude', totalTokens: 500, costUsd: 0.07 },
    ];
    const s = tokensByModelSeries(rows);
    // The y-values are the TOKEN sums, not the cost sums — the whole point of #178.
    expect(s.find((x) => x.name === 'gpt-4')?.points[0].y).toBe(900);
    expect(s.find((x) => x.name === 'claude')?.points[0].y).toBe(500);
    // ...and distinct from what costByModelSeries would plot for the same rows.
    const c = costByModelSeries(rows);
    expect(c.find((x) => x.name === 'gpt-4')?.points[0].y).toBe(0.03);
  });

  it('tokensByModelSeries: ranks top-N by tokens and collapses the rest into Others', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      periodStart: 'a',
      model: `m${i}`,
      totalTokens: 8 - i, // m0 most tokens … m7 least
      costUsd: 1,
    }));
    const s = tokensByModelSeries(rows, 5);
    expect(s.map((x) => x.name)).toContain('Others');
    expect(s).toHaveLength(6);
    // Others aggregates m5+m6+m7 tokens = 3+2+1 = 6
    expect(s.find((x) => x.name === 'Others')?.points[0].y).toBe(6);
  });

  it('tokensByModelSeries: empty input → no series', () => {
    expect(tokensByModelSeries([])).toEqual([]);
  });
});
