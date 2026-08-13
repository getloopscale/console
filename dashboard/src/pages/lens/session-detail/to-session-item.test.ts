// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toSessionItem } from './to-session-item';
import type { Trace } from '../traces/columns';

/**
 * M9 adoption — unit tests for the pure `Trace → SessionTraceItem` boundary mapper. Mirrors the M8
 * `to-trace-span.test.ts` precedent: the mapping is pure + total, so every branch (endTime compute,
 * status collapse, missing-value pass-through) is exercised here, off the DOM.
 */
describe('toSessionItem (Trace → SessionTraceItem)', () => {
  const base: Trace = { traceId: 't1', name: 'agent.run', startTimeUnixNano: '1000000000' };

  it('maps identity fields (id ← traceId, name pass-through)', () => {
    const item = toSessionItem(base);
    expect(item.id).toBe('t1');
    expect(item.name).toBe('agent.run');
    expect(item.startTime).toBe('1000000000');
  });

  it('computes endTime = startTimeUnixNano + durationMs (in ns) as a bigint', () => {
    // 1_000_000_000 ns start + 5ms (5 * 1e6 = 5_000_000 ns) = 1_005_000_000 ns
    const item = toSessionItem({ ...base, durationMs: 5 });
    expect(item.endTime).toBe(1_005_000_000n);
  });

  it('rounds fractional-millisecond durations to whole ns', () => {
    // 2.5ms → round(2.5 * 1e6) = 2_500_000 ns
    const item = toSessionItem({ ...base, startTimeUnixNano: '0', durationMs: 2.5 });
    expect(item.endTime).toBe(2_500_000n);
  });

  it('yields null endTime when durationMs is absent (in-flight / unknown)', () => {
    const item = toSessionItem(base);
    expect(item.endTime).toBeNull();
  });

  it('yields null endTime when startTimeUnixNano is absent (cannot anchor the end)', () => {
    const item = toSessionItem({ traceId: 't1', durationMs: 5 });
    expect(item.startTime).toBeUndefined();
    expect(item.endTime).toBeNull();
  });

  it('yields null endTime when startTimeUnixNano is non-numeric (never throws)', () => {
    const item = toSessionItem({ traceId: 't1', startTimeUnixNano: 'not-a-number', durationMs: 5 });
    expect(item.endTime).toBeNull();
  });

  it('maps the OTLP error tokens to "ERROR" (statusCode 2 / ERROR / STATUS_CODE_ERROR)', () => {
    expect(toSessionItem({ ...base, statusCode: '2' }).status).toBe('ERROR');
    expect(toSessionItem({ ...base, statusCode: 'STATUS_CODE_ERROR' }).status).toBe('ERROR');
    // the lowercase string form the columns renderer also honors
    expect(toSessionItem({ ...base, status: 'error' }).status).toBe('ERROR');
  });

  it('maps OK / unset / unknown status to "OK" (fail-safe, never fabricates an error)', () => {
    expect(toSessionItem({ ...base, statusCode: '1', status: 'ok' }).status).toBe('OK');
    expect(toSessionItem({ ...base, statusCode: '0' }).status).toBe('OK');
    expect(toSessionItem({ ...base, status: 'unknown-token' }).status).toBe('OK');
  });

  it('leaves status undefined when the trace carries no status at all (honest absence)', () => {
    const item = toSessionItem(base);
    expect(item.status).toBeUndefined();
  });

  it('passes model / costUsd / totalTokens through, leaving absent numerics undefined', () => {
    const item = toSessionItem({ ...base, model: 'gpt-4o', costUsd: 0.0123, totalTokens: 512 });
    expect(item.model).toBe('gpt-4o');
    expect(item.costUsd).toBe(0.0123);
    expect(item.totalTokens).toBe(512);

    const bare = toSessionItem(base);
    expect(bare.model).toBeUndefined();
    expect(bare.costUsd).toBeUndefined();
    expect(bare.totalTokens).toBeUndefined();
  });

  it('preserves an honest zero cost / zero tokens (0 is data, not absence)', () => {
    const item = toSessionItem({ ...base, costUsd: 0, totalTokens: 0 });
    expect(item.costUsd).toBe(0);
    expect(item.totalTokens).toBe(0);
  });
});
