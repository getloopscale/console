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
});
