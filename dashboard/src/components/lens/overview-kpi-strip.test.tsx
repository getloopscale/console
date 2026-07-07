import { describe, it, expect, vi, afterEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { OverviewKpiStrip, type KpiTile, type OverviewMetric } from './overview-kpi-strip';

/**
 * M60 P1 T1.1 — the KPI strip. Each tile renders a period-over-period delta (from `periodDelta`),
 * shows "N/A" on a sparse/un-splittable window (never a fabricated delta — R3), degrades its delta
 * away below the full width threshold (`cardMode`), and reports the clicked metric to swap the shared
 * chart. A controllable `ResizeObserver` mock drives the degradation case deterministically.
 */

const tiles: KpiTile[] = [
  { key: 'throughput', title: 'Traces', value: '40', series: [10, 10, 20, 20], agg: 'sum', invert: false }, // +100%
  { key: 'errorRate', title: 'Error rate %', value: '5%', series: [0.1, 0.1, 0.05, 0.05], agg: 'mean', invert: true },
  { key: 'latency', title: 'Latency p95 (ms)', value: '90ms', series: [100, 100, 80, 80], agg: 'mean', invert: true },
  { key: 'cost', title: 'Cost (USD)', value: '$1.20', series: [1, 1, 2, 2], agg: 'sum', invert: true }, // +100%
];

// A ResizeObserver mock whose fired width is configurable per test (jsdom has none).
let roWidth = 0; // 0 → never fire (component keeps its 240/full default)
class MockResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe() {
    if (roWidth > 0) this.cb([{ contentRect: { width: roWidth } } as ResizeObserverEntry], this);
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

afterEach(() => {
  roWidth = 0;
  vi.clearAllMocks();
});

describe('M60 OverviewKpiStrip', () => {
  it('renders a period-over-period delta on a rising metric (full width default)', () => {
    render(<OverviewKpiStrip tiles={tiles} onSelectMetric={() => {}} />);
    expect(screen.getAllByText('+100%').length).toBeGreaterThanOrEqual(1); // throughput + cost both +100%
    // the honest window disclosure is shown on a computable delta.
    expect(screen.getAllByText(/vs first half of window/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows "N/A" (no fabricated delta) on a sparse / un-splittable window', () => {
    const sparse: KpiTile[] = [{ ...tiles[0], series: [5] }]; // single bucket → un-splittable
    render(<OverviewKpiStrip tiles={sparse} onSelectMetric={() => {}} />);
    expect(screen.getByText(/N\/A/i)).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument(); // no percent delta fabricated
  });

  it('degrades the delta away below the full width threshold (cardMode no-delta)', () => {
    roWidth = 600; // 600 / 4 tiles = 150 per card → below 160 → icon-only/no-delta
    render(<OverviewKpiStrip tiles={tiles} onSelectMetric={() => {}} />);
    expect(screen.queryByText('+100%')).not.toBeInTheDocument(); // delta dropped
    expect(screen.getByText('Traces')).toBeInTheDocument(); // the tile itself still renders
  });

  it('fires onSelectMetric with the clicked metric key', async () => {
    const onSelect = vi.fn<(m: OverviewMetric) => void>();
    render(<OverviewKpiStrip tiles={tiles} onSelectMetric={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /show latency p95 \(ms\) trend/i }));
    expect(onSelect).toHaveBeenCalledWith('latency');
  });

  it('marks the selected tile pressed', () => {
    render(<OverviewKpiStrip tiles={tiles} onSelectMetric={() => {}} selected="cost" />);
    expect(screen.getByRole('button', { name: /show cost \(usd\) trend/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
