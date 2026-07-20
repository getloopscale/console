import { describe, it, expect } from 'vitest';
import { traceSummary } from './summary';

describe('traceSummary (M72 — the trace-level headline)', () => {
  const root = {
    spanId: 'root',
    traceId: 't1',
    name: 'root',
    startTimeUnixNano: '1000000000',
    endTimeUnixNano: '2000000000', // +1e9 ns = 1000ms
    inputTokens: 100,
    outputTokens: 50,
    model: 'gpt-4o',
    statusCode: '0',
    children: [
      { spanId: 'a', traceId: 't1', name: 'a', model: 'claude-haiku', inputTokens: 200, outputTokens: 40, statusCode: 'STATUS_CODE_ERROR' },
      { spanId: 'b', traceId: 't1', name: 'b', model: 'gpt-4o', inputTokens: 10, outputTokens: 0, statusCode: '1' },
    ],
  };

  it('sums tokens, counts error spans, and lists distinct models', () => {
    const s = traceSummary(root);
    expect(s.totalTokens).toBe(100 + 50 + 200 + 40 + 10 + 0); // 400
    expect(s.errorCount).toBe(1); // only span 'a' (STATUS_CODE_ERROR); root '0' + 'b' '1' are OK
    expect(s.models).toEqual(['claude-haiku', 'gpt-4o']); // distinct + sorted
    expect(s.durationMs).toBe(1000); // root wall-clock
  });

  it('an empty trace is honest zeros, not fabricated values', () => {
    const s = traceSummary({ spanId: 'r', traceId: 't', name: 'r', children: [] });
    expect(s.totalTokens).toBe(0);
    expect(s.errorCount).toBe(0);
    expect(s.models).toEqual([]);
  });

  it('prefers the stored trace cost on the root over re-summing per-span costs (M53 / #73)', () => {
    // The #73 shape: interaction root carries the authoritative trace cost (attached by the lens
    // getTraceTree from traces.cost_usd); children have NO per-span cost. The header must show the
    // trace cost ($0.40), never a fabricated $0.0000 from summing empty per-span costs.
    const withStoredCost = {
      spanId: 'root',
      traceId: 't',
      name: 'claude_code.interaction',
      costUsd: 0.4,
      children: [
        { spanId: 'c1', traceId: 't', name: 'claude_code.llm_request', inputTokens: 328, outputTokens: 4341 },
        { spanId: 'c2', traceId: 't', name: 'claude_code.tool' },
      ],
    };
    expect(traceSummary(withStoredCost).costUsd).toBeCloseTo(0.4, 6);
  });

  it('uses the authoritative root cost and does NOT double-count a child that carries its own cost (M53 / #73)', () => {
    // root.costUsd is the trace TOTAL; if a child ever also carries a cost, summing both would
    // over-count. The header must show the authoritative total (0.4), never 0.5.
    const root = {
      spanId: 'root',
      traceId: 't',
      name: 'claude_code.interaction',
      costUsd: 0.4,
      children: [{ spanId: 'c', traceId: 't', name: 'llm', costUsd: 0.1 }],
    };
    expect(traceSummary(root).costUsd).toBeCloseTo(0.4, 6);
  });

  it('falls back to aggregating per-span costs when the root has no stored cost', () => {
    const noStored = {
      spanId: 'root',
      traceId: 't',
      name: 'root',
      children: [{ spanId: 'c', traceId: 't', name: 'llm', costUsd: 0.03 }],
    };
    expect(traceSummary(noStored).costUsd).toBeCloseTo(0.03, 6);
  });
});
