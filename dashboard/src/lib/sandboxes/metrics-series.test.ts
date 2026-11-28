// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { appendSample, cpuPoints, type MetricsSample } from './metrics-series';

const sample = (at: string, cpuNs: number, over: Partial<MetricsSample> = {}): MetricsSample => ({
  at,
  cpu_usage_ns: cpuNs,
  memory_used_bytes: 100,
  memory_limit_bytes: 400,
  ...over,
});

describe('appendSample', () => {
  it('adds a sample to the end and drops the oldest past the limit', () => {
    const series = [sample('2026-11-28T10:00:00Z', 0), sample('2026-11-28T10:00:03Z', 1)];

    const next = appendSample(series, sample('2026-11-28T10:00:06Z', 2), 2);

    expect(next.map((s) => s.cpu_usage_ns)).toEqual([1, 2]);
  });

  it('ignores a sample taken at the same instant as the last one', () => {
    const series = [sample('2026-11-28T10:00:00Z', 0)];

    expect(appendSample(series, sample('2026-11-28T10:00:00Z', 0), 10)).toHaveLength(1);
  });
});

describe('cpuPoints', () => {
  it('turns the CPU time between two samples into cores in use', () => {
    const points = cpuPoints([
      sample('2026-11-28T10:00:00Z', 0),
      sample('2026-11-28T10:00:02Z', 1_000_000_000), // 1s of CPU in 2s: half a core
      sample('2026-11-28T10:00:04Z', 5_000_000_000), // 4s of CPU in 2s: two cores
    ]);

    expect(points).toEqual([
      { t: Date.parse('2026-11-28T10:00:02Z') / 1000, v: 0.5 },
      { t: Date.parse('2026-11-28T10:00:04Z') / 1000, v: 2 },
    ]);
  });

  it('reads zero when the counter went back, as it does after a resume on some drivers', () => {
    const points = cpuPoints([sample('2026-11-28T10:00:00Z', 9), sample('2026-11-28T10:00:02Z', 3)]);

    expect(points[0]?.v).toBe(0);
  });

  it('has no point with fewer than two samples', () => {
    expect(cpuPoints([sample('2026-11-28T10:00:00Z', 5)])).toEqual([]);
  });
});
