import { describe, it, expect } from 'vitest';

import {
  aggregateCost,
  computeBarLayout,
  computeTraceBounds,
  niceAxisTicks,
  packRows,
  spanCostUsd,
  type TraceSpanNode,
} from './trace-layout';

/**
 * M58 T1.1 — pure/total layout math for the waterfall. Every function here is exercised for its
 * boundary (edge) AND its invalid (negative) inputs per rules/testing.md §4.1: skew (end < start),
 * missing timestamps, overlapping spans, degenerate bounds, and missing cost. None may throw.
 */

/** Minimal span factory — only the fields the layout math reads. */
function span(over: Partial<TraceSpanNode> = {}): TraceSpanNode {
  return { spanId: 's', traceId: 't', name: 'n', ...over };
}

describe('computeBarLayout — moved to trace-layout.ts, still pure + total', () => {
  it('skew (end < start) → widthPct ≥ 0 and unbounded flagged, no throw', () => {
    // trace bounds 0..10; a span whose end (5) precedes its start (10) is clock-skewed.
    const layout = computeBarLayout('10', '5', 0n, 10n);
    expect(layout.widthPct).toBeGreaterThanOrEqual(0);
    expect(layout.unbounded).toBeTruthy();
  });

  it('missing endTimeUnixNano → unbounded:true (no throw)', () => {
    const layout = computeBarLayout('2', undefined, 0n, 10n);
    expect(layout.unbounded).toBe(true);
    expect(layout.widthPct).toBeGreaterThanOrEqual(0);
  });
});

describe('computeTraceBounds — moved to trace-layout.ts', () => {
  it('is the min-start / max-end envelope across the whole subtree', () => {
    const root = span({
      spanId: 'root',
      startTimeUnixNano: '100',
      endTimeUnixNano: '200',
      children: [span({ spanId: 'c', startTimeUnixNano: '150', endTimeUnixNano: '500' })],
    });
    const b = computeTraceBounds(root);
    expect(b.startNs).toBe(100n);
    expect(b.endNs).toBe(500n);
  });
});

describe('packRows — overlapping spans stack on separate rows', () => {
  it('assigns overlapping A(0..10) and B(2..8) to DIFFERENT rows', () => {
    const rows = packRows([
      { spanId: 'A', startNs: 0n, endNs: 10n },
      { spanId: 'B', startNs: 2n, endNs: 8n },
    ]);
    expect(rows.get('A')).not.toBe(rows.get('B'));
  });

  it('reuses a row for a span that starts after an earlier one ended', () => {
    // A 0..10, B 2..8 (overlaps A → row 1), C 12..15 (after A ended → back to row 0).
    const rows = packRows([
      { spanId: 'A', startNs: 0n, endNs: 10n },
      { spanId: 'B', startNs: 2n, endNs: 8n },
      { spanId: 'C', startNs: 12n, endNs: 15n },
    ]);
    expect(rows.get('C')).toBe(rows.get('A'));
    expect(rows.get('B')).not.toBe(rows.get('A'));
  });

  it('empty input → empty map (no throw)', () => {
    expect(packRows([]).size).toBe(0);
  });
});

describe('niceAxisTicks — human-friendly time axis', () => {
  it('a 5s trace at 600px yields ticks whose adjacent leftPct gap ≥ 70/600*100 with s-shaped labels', () => {
    const fiveSecNs = 5_000_000_000n; // 5s in ns
    const ticks = niceAxisTicks(0n, fiveSecNs, 600);
    expect(ticks.length).toBeGreaterThan(1);
    const minGap = (70 / 600) * 100; // ≈ 11.67 %
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].leftPct - ticks[i - 1].leftPct).toBeGreaterThanOrEqual(minGap);
    }
    // A multi-second trace labels its ticks in seconds ("1s", "2s", …).
    expect(ticks.some((t) => /^\d+(\.\d+)?s$/.test(t.label))).toBe(true);
  });

  it('degenerate / all-missing bounds (start == end) → empty array (no throw)', () => {
    expect(niceAxisTicks(0n, 0n, 600)).toEqual([]);
  });

  it('labels sub-millisecond magnitudes in ms, not seconds', () => {
    const ms = niceAxisTicks(0n, 10_000_000n, 600); // 10ms window
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((t) => /ms$/.test(t.label))).toBe(true);
  });
});

describe('spanCostUsd + aggregateCost — ∑ subtree cost, total (never NaN)', () => {
  it('reads a per-span cost and aggregates own + descendants (∑)', () => {
    const node = span({
      spanId: 'root',
      costUsd: 0.01,
      children: [span({ spanId: 'c', costUsd: 0.02 })],
    });
    expect(aggregateCost(node)).toBeCloseTo(0.03);
  });

  it('a node with missing cost contributes 0, never NaN', () => {
    const node = span({
      spanId: 'root',
      children: [span({ spanId: 'c', costUsd: 0.05 })],
    }); // root has no cost
    const total = aggregateCost(node);
    expect(Number.isNaN(total)).toBe(false);
    expect(total).toBeCloseTo(0.05);
  });

  it('spanCostUsd falls back to a cost attribute and yields 0 (not NaN) when absent', () => {
    expect(spanCostUsd(span({ attributes: { 'gen_ai.usage.cost': 0.007 } }))).toBeCloseTo(0.007);
    expect(spanCostUsd(span())).toBe(0);
    expect(Number.isNaN(spanCostUsd(span({ attributes: { 'gen_ai.usage.cost': 'oops' } })))).toBe(false);
  });
});
