// @vitest-environment node
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
    // theo-cloud#186 SUPERSEDES the former `toBe(0)` assertion on this line. A trace whose spans never
    // recorded a token count is UNKNOWN, not zero — and the per-span rows below the header already
    // render `—` for exactly this span (M89). The header claiming "0" while the rows say "—" is the
    // two surfaces disagreeing about the same trace, which is the whole finding.
    expect(s.totalTokens).toBeNaN();
    expect(s.errorCount).toBe(0);
    expect(s.models).toEqual([]);
  });

  /**
   * theo-cloud#186 — the trace-level roll-up showed "0" for an all-unmeasured trace while the per-span
   * rows showed "—". M89 fixed the per-span half and deliberately scoped the aggregate out (ADR-3),
   * because an aggregate 0 is genuinely ambiguous: a trace with no token-bearing spans has a REAL 0,
   * while a trace whose spans exist but never recorded tokens is UNKNOWN. Distinguishing them needs to
   * know whether ANY descendant is token-bearing — which is what these tests pin.
   */
  describe('#186 — an all-unmeasured trace is unknown, not zero', () => {
    const span = (id: string, extra: Record<string, unknown> = {}) => ({ spanId: id, traceId: 't', name: id, ...extra });

    it('is NaN (rendered "—") when NO span recorded a token count', () => {
      const s = traceSummary({ ...span('r'), children: [span('a'), span('b')] });
      expect(s.totalTokens).toBeNaN();
    });

    it('is the real sum when at least one span recorded — including a genuine zero', () => {
      // The ambiguity M89 named: this trace DID measure, and it measured 0. That 0 is a fact and must
      // survive as a number. Reporting "—" here would be the mirror-image lie.
      const s = traceSummary({ ...span('r'), children: [span('a', { inputTokens: 0, outputTokens: 0 }), span('b')] });
      expect(s.totalTokens).toBe(0);
    });

    it('counts a HALF-recorded span as measured (same rule as the per-span column)', () => {
      // M89's per-span rule: only "both counts absent" is unknown; one half recorded is a real value.
      // The aggregate must use the identical predicate or the two surfaces disagree again.
      const s = traceSummary({ ...span('r'), children: [span('a', { inputTokens: 7 })] });
      expect(s.totalTokens).toBe(7);
    });

    it('does not let one unmeasured sibling erase a measured one', () => {
      const s = traceSummary({ ...span('r'), children: [span('a', { inputTokens: 5, outputTokens: 5 }), span('b')] });
      expect(s.totalTokens).toBe(10);
    });
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
