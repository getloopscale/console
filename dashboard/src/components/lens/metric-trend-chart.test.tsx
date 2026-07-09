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

  it('M90 — the a11y table reads ragged series by shared period axis, not by array position', () => {
    // Two evaluators over a shared 3-period axis (x=0,1,2). "sparse" has NO point at x=1
    // (a real gap — the M90 score-trend shape). The a11y table MUST place sparse's x=2 value
    // (0.9) under period 3, NOT under period 2 (the positional-index bug mis-attributes it).
    render(
      <MetricTrendChart
        title="Scores"
        series={[
          { name: 'dense', color: '#111', points: [{ x: 0, y: 0.1 }, { x: 1, y: 0.2 }, { x: 2, y: 0.3 }] },
          { name: 'sparse', color: '#222', points: [{ x: 0, y: 0.7 }, { x: 2, y: 0.9 }] },
        ]}
      />,
    );
    const rows = within(screen.getByTestId('trend-table')).getAllByRole('row');
    // header + 3 period rows
    expect(rows).toHaveLength(4);
    // period 2 (x=1): dense=0.2, sparse=missing → "—" (NOT 0.9)
    const period2 = within(rows[2]!).getAllByRole('cell').map((c) => c.textContent);
    expect(period2).toEqual(['2', '0.2', '—']);
    // period 3 (x=2): dense=0.3, sparse=0.9 (correctly attributed, not read one row early)
    const period3 = within(rows[3]!).getAllByRole('cell').map((c) => c.textContent);
    expect(period3).toEqual(['3', '0.3', '0.9']);
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

  it('M76 (O-2) — marks each point on a sparse series (<5 points) so a 2-4 point line is not a cliff', () => {
    render(<MetricTrendChart title="Throughput" series={[{ name: 'traces', color: '#111', points: [{ x: 0, y: 5 }, { x: 1, y: 40 }, { x: 2, y: 8 }] }]} />);
    expect(screen.getAllByTestId('trend-dot')).toHaveLength(3); // one marker per point
  });

  it('M76 (O-2) — a dense series (≥5 points) draws the line only, no per-point markers', () => {
    const dense = [{ name: 'traces', color: '#111', points: Array.from({ length: 6 }, (_, i) => ({ x: i, y: i * 2 })) }];
    render(<MetricTrendChart title="Throughput" series={dense} />);
    expect(screen.queryByTestId('trend-dot')).not.toBeInTheDocument();
    expect(screen.getByTestId('trend-line')).toBeInTheDocument();
  });

  it('renders an a11y value table mirroring the series (screen-reader parity)', () => {
    render(<MetricTrendChart title="Latency" series={twoSeries} yFormat={(v) => `${v}ms`} />);
    const table = screen.getByTestId('trend-table');
    expect(within(table).getByText('p50')).toBeInTheDocument();
    expect(within(table).getByText('p95')).toBeInTheDocument();
    expect(within(table).getByText('10ms')).toBeInTheDocument(); // formatted value present
  });
});
