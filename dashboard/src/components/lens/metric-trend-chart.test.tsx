import { describe, it, expect } from 'vitest';
import { within } from '@testing-library/react';
import { render, screen } from '@/test/render';

import { MetricTrendChart, linScale, niceMax, seriesPath } from './metric-trend-chart';

describe('metric-trend-chart pure helpers (M51)', () => {
  it('linScale maps the domain onto the range', () => {
    const s = linScale([0, 10], [0, 100]);
    expect(s(0)).toBe(0);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(100);
  });

  it('linScale guards a zero-width domain (maps to r0, no NaN)', () => {
    const s = linScale([7, 7], [20, 80]);
    expect(s(7)).toBe(20);
    expect(Number.isFinite(s(7))).toBe(true);
  });

  it('niceMax rounds up to a clean bound ≥ max', () => {
    expect(niceMax([3, 47, 12])).toBeGreaterThanOrEqual(47);
    expect(niceMax([3, 47, 12])).toBe(50);
    expect(niceMax([])).toBe(0);
    expect(niceMax([0, 0])).toBe(0);
  });

  it('seriesPath builds an SVG polyline with one coord per point', () => {
    const xs = linScale([0, 2], [0, 100]);
    const ys = linScale([0, 10], [100, 0]);
    const d = seriesPath([{ x: 0, y: 0 }, { x: 1, y: 5 }, { x: 2, y: 10 }], xs, ys);
    expect(d.startsWith('M')).toBe(true);
    expect((d.match(/[ML]/g) ?? []).length).toBe(3); // 1 move + 2 lines
    expect(seriesPath([], xs, ys)).toBe('');
  });
});

describe('MetricTrendChart (M51)', () => {
  const twoSeries = [
    { name: 'p50', color: '#111', points: [{ x: 0, y: 10 }, { x: 1, y: 20 }] },
    { name: 'p95', color: '#222', points: [{ x: 0, y: 30 }, { x: 1, y: 40 }] },
  ];

  it('renders one path per series', () => {
    render(<MetricTrendChart title="Latency" series={twoSeries} />);
    expect(screen.getAllByTestId('trend-line')).toHaveLength(2);
  });

  it('renders an explicit empty-state when there is no data (not a zero line)', () => {
    render(<MetricTrendChart title="Latency" series={[{ name: 'p50', color: '#111', points: [] }]} />);
    expect(screen.getByTestId('trend-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('trend-line')).not.toBeInTheDocument();
  });

  it('draws a visible dot for a single-bucket series (a collapsed polyline would be invisible)', () => {
    render(<MetricTrendChart title="Throughput" series={[{ name: 'traces', color: '#111', points: [{ x: 0, y: 5 }] }]} />);
    expect(screen.getByTestId('trend-dot')).toBeInTheDocument();
  });

  it('renders an a11y value table mirroring the series (screen-reader parity)', () => {
    render(<MetricTrendChart title="Latency" series={twoSeries} yFormat={(v) => `${v}ms`} />);
    const table = screen.getByTestId('trend-table');
    expect(within(table).getByText('p50')).toBeInTheDocument();
    expect(within(table).getByText('p95')).toBeInTheDocument();
    expect(within(table).getByText('10ms')).toBeInTheDocument(); // formatted value present
  });
});
