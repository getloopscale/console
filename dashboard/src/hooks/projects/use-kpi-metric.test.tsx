import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('./use-metrics-range', () => ({ useMetricsRange: vi.fn() }));

import { useKpiMetric } from './use-kpi-metric';
import { useMetricsRange } from './use-metrics-range';

const mocked = vi.mocked(useMetricsRange);

function withData(points: { t: number; v: number }[]) {
  mocked.mockReturnValue({
    data: points,
    status: 'ok',
    loading: false,
    error: false,
  } as unknown as ReturnType<typeof useMetricsRange>);
}

beforeEach(() => vi.clearAllMocks());

// J-18 — the KPI current-value derivation: last point × multiplier.
describe('useKpiMetric', () => {
  it('returns the LATEST point × multiplier (uptime 0.995 → 99.5%)', () => {
    withData([
      { t: 1, v: 0.99 },
      { t: 2, v: 0.995 },
    ]);
    const { result } = renderHook(() => useKpiMetric('p', 'production', 'uptime_24h', 100));
    expect(result.current).toBe(99.5);
  });

  it('converts seconds → ms for p95 (×1000)', () => {
    withData([{ t: 1, v: 0.031 }]);
    const { result } = renderHook(() => useKpiMetric('p', 'production', 'p95_latency', 1000));
    expect(result.current).toBe(31);
  });

  it('passes rps through unchanged (×1 default)', () => {
    withData([{ t: 1, v: 42 }]);
    const { result } = renderHook(() => useKpiMetric('p', 'production', 'rps'));
    expect(result.current).toBe(42);
  });

  it('returns null when there is no data (collecting / unreachable)', () => {
    withData([]);
    const { result } = renderHook(() => useKpiMetric('p', 'production', 'rps'));
    expect(result.current).toBeNull();
  });

  it('returns null when the latest value is not a finite number', () => {
    withData([{ t: 1, v: NaN }]);
    const { result } = renderHook(() => useKpiMetric('p', 'production', 'rps'));
    expect(result.current).toBeNull();
  });
});
