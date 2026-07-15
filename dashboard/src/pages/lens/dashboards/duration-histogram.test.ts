import { describe, it, expect } from 'vitest';

import { durationsFromTraces } from './duration-histogram';
import type { Trace } from '../traces/columns';

describe('durationsFromTraces (M11 — duration histogram source)', () => {
  it('keeps every finite durationMs in order', () => {
    const traces: Trace[] = [
      { traceId: 't1', durationMs: 120 },
      { traceId: 't2', durationMs: 340 },
      { traceId: 't3', durationMs: 0 }, // 0ms is a defined measurement, not "absent" — kept
    ];
    expect(durationsFromTraces(traces)).toEqual([120, 340, 0]);
  });

  it('drops a trace with no durationMs (never binned as a fabricated 0)', () => {
    const traces: Trace[] = [{ traceId: 't1', durationMs: 200 }, { traceId: 't2' }];
    expect(durationsFromTraces(traces)).toEqual([200]);
  });

  it('drops non-finite durations (NaN / ±Infinity)', () => {
    const traces: Trace[] = [
      { traceId: 't1', durationMs: Number.NaN },
      { traceId: 't2', durationMs: Number.POSITIVE_INFINITY },
      { traceId: 't3', durationMs: 55 },
    ];
    expect(durationsFromTraces(traces)).toEqual([55]);
  });

  it('empty input → empty (the Histogram owns its own empty state)', () => {
    expect(durationsFromTraces([])).toEqual([]);
  });
});
