import { describe, it, expect } from 'vitest';
import {
  numericDelta,
  alignSpanTrees,
  traceMetrics,
  spanTokens,
  isErrorStatus,
  type TraceCostSummary,
} from './compare-core';
import type { TraceSpanNode } from './trace-detail';

// Helpers to build span nodes tersely.
function span(
  spanId: string,
  name: string,
  extra: Partial<TraceSpanNode> = {},
  children: TraceSpanNode[] = [],
): TraceSpanNode {
  return { spanId, traceId: 't', name, children, ...extra };
}

describe('numericDelta — honest delta math (null on equal or missing side)', () => {
  it('current > baseline → "+", absolute + percent', () => {
    // Given B is slower/costlier than A (baseline)
    expect(numericDelta(120, 100)).toEqual({ absolute: 20, direction: '+', percent: 20 });
  });
  it('current < baseline → "−" (minus sign), absolute + percent', () => {
    expect(numericDelta(80, 100)).toEqual({ absolute: 20, direction: '−', percent: 20 });
  });
  it('equal values → null (no delta badge, no visual noise)', () => {
    expect(numericDelta(100, 100)).toBeNull();
  });
  it('a missing side → null (never a fabricated delta)', () => {
    expect(numericDelta(50, undefined)).toBeNull();
    expect(numericDelta(undefined, 50)).toBeNull();
  });
  it('baseline 0 → percent null but absolute still reported', () => {
    expect(numericDelta(5, 0)).toEqual({ absolute: 5, direction: '+', percent: null });
  });
});

describe('alignSpanTrees — match by name+kind+sibling-ordinal, honest "only-in" markers', () => {
  it('identical structure → every row matched, comparable:true', () => {
    const a = span('a0', 'root', {}, [span('a1', 'llm.call'), span('a2', 'tool')]);
    const b = span('b0', 'root', {}, [span('b1', 'llm.call'), span('b2', 'tool')]);
    const r = alignSpanTrees(a, b);
    expect(r.comparable).toBe(true);
    expect(r.rows.every((row) => row.status === 'matched')).toBe(true);
    expect(r.rows).toHaveLength(3); // root + 2 children
  });

  it('B has one extra child → that row is only-in-b, siblings still matched, comparable:false', () => {
    const a = span('a0', 'root', {}, [span('a1', 'llm.call')]);
    const b = span('b0', 'root', {}, [span('b1', 'llm.call'), span('b2', 'extra')]);
    const r = alignSpanTrees(a, b);
    expect(r.comparable).toBe(false);
    const extra = r.rows.find((row) => row.b?.name === 'extra');
    expect(extra?.status).toBe('only-in-b');
    expect(r.rows.find((row) => row.a?.name === 'llm.call' && row.b?.name === 'llm.call')?.status).toBe('matched');
  });

  it('a span renamed in B → both become only-in (not a false pair)', () => {
    const a = span('a0', 'root', {}, [span('a1', 'old-name')]);
    const b = span('b0', 'root', {}, [span('b1', 'new-name')]);
    const r = alignSpanTrees(a, b);
    expect(r.comparable).toBe(false);
    expect(r.rows.find((row) => row.a?.name === 'old-name')?.status).toBe('only-in-a');
    expect(r.rows.find((row) => row.b?.name === 'new-name')?.status).toBe('only-in-b');
    // never a fabricated pairing of old-name↔new-name
    expect(r.rows.some((row) => row.a?.name === 'old-name' && row.b?.name === 'new-name')).toBe(false);
  });

  it('reordered siblings with same name+kind → still matched by ordinal', () => {
    const a = span('a0', 'root', {}, [span('a1', 'x', { kind: 'K' }), span('a2', 'y', { kind: 'K' })]);
    const b = span('b0', 'root', {}, [span('b1', 'y', { kind: 'K' }), span('b2', 'x', { kind: 'K' })]);
    const r = alignSpanTrees(a, b);
    expect(r.comparable).toBe(true);
    expect(r.rows.filter((row) => row.status === 'matched')).toHaveLength(3);
  });

  it('repeated same-name siblings disambiguated by ordinal', () => {
    const a = span('a0', 'root', {}, [span('a1', 'llm'), span('a2', 'llm')]);
    const b = span('b0', 'root', {}, [span('b1', 'llm')]); // only one llm on B
    const r = alignSpanTrees(a, b);
    expect(r.comparable).toBe(false);
    const onlyA = r.rows.filter((row) => row.status === 'only-in-a');
    expect(onlyA).toHaveLength(1); // the second llm (ordinal 1) is only in A
  });
});

describe('traceMetrics — per-trace roll-up from tree + cost summary', () => {
  const cost: TraceCostSummary = { traceId: 't', costUsd: 0.42, totalTokens: 300 };

  it('duration from root, tokens from cost summary, cost from summary, no error', () => {
    const root = span('r', 'root', {
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '1002000000', // +2_000_000 ns = 2 ms
    });
    const m = traceMetrics(root, cost);
    expect(m.durationMs).toBe(2);
    expect(m.tokens).toBe(300);
    expect(m.costUsd).toBe(0.42);
    expect(m.hasError).toBe(false);
  });

  it('hasError true when any span statusCode !== "0"', () => {
    const root = span('r', 'root', {}, [span('c', 'child', { statusCode: '2' })]);
    expect(traceMetrics(root, cost).hasError).toBe(true);
  });

  it('cost undefined → costUsd null (degraded, never fabricated); tokens fall back to tree sum', () => {
    const root = span('r', 'root', { inputTokens: 10, outputTokens: 5 });
    const m = traceMetrics(root, undefined);
    expect(m.costUsd).toBeNull();
    expect(m.tokens).toBe(15);
  });
});

describe('per-span helpers', () => {
  it('spanTokens sums input+output for the node only (not descendants)', () => {
    expect(spanTokens(span('s', 'x', { inputTokens: 7, outputTokens: 3 }, [span('c', 'y', { inputTokens: 100 })]))).toBe(10);
    expect(spanTokens(span('s', 'x'))).toBe(0);
  });
  it('isErrorStatus: only a set, non-"0" code is an error', () => {
    expect(isErrorStatus('2')).toBe(true);
    expect(isErrorStatus('0')).toBe(false);
    expect(isErrorStatus(undefined)).toBe(false);
  });
});
