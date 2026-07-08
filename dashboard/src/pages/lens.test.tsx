import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensOverviewPage } from './lens';

// A full observability series fixture (traffic/latency/tokensByModel) + a cost summary.
function seriesMock(overrides: Record<string, unknown> = {}) {
  mockCloudFetch.mockImplementation((url: string) => {
    if (url.includes('observability')) {
      return Promise.resolve({
        range: '24h',
        traffic: [
          { periodStart: 'a', traceCount: 8, errorCount: 2, errorRate: 0.25 },
          { periodStart: 'b', traceCount: 2, errorCount: 0, errorRate: 0 },
        ],
        latency: [
          { periodStart: 'a', p50Ms: 10, p95Ms: 1234, p99Ms: 1500 },
          { periodStart: 'b', p50Ms: 12, p95Ms: 900, p99Ms: 1100 },
        ],
        tokensByModel: [
          { periodStart: 'a', model: 'claude-opus-4-8', totalTokens: 100, costUsd: 0.5 },
          { periodStart: 'b', model: 'claude-haiku-4-5', totalTokens: 40, costUsd: 0.1 },
        ],
        ...overrides,
      });
    }
    return Promise.resolve({});
  });
}

const obsUrls = () => mockCloudFetch.mock.calls.map((c) => c[0] as string).filter((u) => u.includes('observability'));

describe('LensOverviewPage (/observability Overview landing)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the KPI strip aggregated from observability + cost, and the Explore grid (no regression)', async () => {
    seriesMock();
    render(<LensOverviewPage />);
    // wait on a data-gated element (the tile value), not the always-present Explore card
    expect(await screen.findByText('10')).toBeInTheDocument(); // 8 + 2 traces (formatNumber grouped)
    expect(screen.getByText('Error rate %')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument(); // 2/10 → the MetricCard value
    expect(screen.getByText('Latency p95 (ms)')).toBeInTheDocument();
    for (const t of ['Traces', 'Sessions', 'Datasets', 'Evaluators', 'Guards', 'Agents', 'Ask']) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('button', { name: /open →/i }).length).toBeGreaterThanOrEqual(7);
  });

  it('M60 — renders ONE shared trend chart (default throughput), swapped by a KPI-tile click', async () => {
    seriesMock();
    render(<LensOverviewPage />);
    await screen.findByText('Throughput (traces)'); // default metric — data-gated barrier
    // only ONE chart shows (not four): the other metric titles are absent until selected.
    expect(screen.queryByText('Latency (ms)')).not.toBeInTheDocument();
    expect(screen.queryByText('Cost by model (USD)')).not.toBeInTheDocument();
    // clicking the Latency tile swaps the shared chart to the latency series/title.
    await userEvent.click(screen.getByRole('button', { name: /show latency p95 \(ms\) trend/i }));
    expect(await screen.findByText('Latency (ms)')).toBeInTheDocument();
    expect(screen.queryByText('Throughput (traces)')).not.toBeInTheDocument();
  });

  it('M60 — the shared chart draws one line per model when the Cost metric is selected', async () => {
    seriesMock();
    render(<LensOverviewPage />);
    await screen.findByRole('button', { name: /show traces trend/i }); // metric-agnostic barrier
    await userEvent.click(screen.getByRole('button', { name: /show cost \(usd\) trend/i }));
    const costChart = (await screen.findByText('Cost by model (USD)')).closest('figure') as HTMLElement;
    expect(costChart.querySelectorAll('[data-testid="trend-line"]')).toHaveLength(2); // opus + haiku
  });

  it('the range selector re-fetches server-side with ?range= (no client re-bucket)', async () => {
    seriesMock();
    render(<LensOverviewPage />);
    await screen.findByRole('button', { name: /show traces trend/i }); // metric-agnostic barrier
    // initial fetch uses the 24h default
    expect(obsUrls().some((u) => u.includes('range=24h'))).toBe(true);
    await userEvent.click(screen.getByRole('combobox', { name: /time range/i }));
    await userEvent.click(await screen.findByRole('option', { name: /last 7 days/i }));
    await waitFor(() => expect(obsUrls().some((u) => u.includes('range=7d'))).toBe(true));
  });

  it('shows an empty-state chart when a series has no data (not a zero line)', async () => {
    seriesMock({ traffic: [], latency: [], tokensByModel: [] });
    render(<LensOverviewPage />);
    await screen.findByRole('button', { name: /show traces trend/i }); // metric-agnostic barrier
    // the ONE shared chart renders its empty-state; it draws no line (not a fabricated zero line).
    expect(screen.getAllByTestId('trend-empty').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('trend-line')).not.toBeInTheDocument();
  });

  it('M68 — a quiet tenant shows em-dash for error-rate + p95, honest 0 for traces (not 0%/0ms)', async () => {
    seriesMock({ traffic: [], latency: [], tokensByModel: [] });
    render(<LensOverviewPage />);
    await screen.findByRole('button', { name: /show traces trend/i }); // metric-agnostic barrier
    // rate/percentile over an EMPTY window are undefined → em-dash, NEVER a misleading 0%/0ms.
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2); // error-rate + p95 tiles
    // a count over an empty window is an honest measurement → 0.
    expect(screen.getByText('0')).toBeInTheDocument(); // Traces tile
  });

  it('M60 — the shared chart exposes an a11y summary (role=img + a visually-hidden value table)', async () => {
    seriesMock();
    render(<LensOverviewPage />);
    await screen.findByRole('button', { name: /show traces trend/i });
    expect(screen.getByTestId('trend-table')).toBeInTheDocument(); // screen-reader parity for the SVG
    expect(screen.getByRole('img', { name: /trend/i })).toBeInTheDocument(); // aria-label summary
  });

  it('shows a warning Alert when the metrics fail to load', async () => {
    mockCloudFetch.mockRejectedValue(new Error('boom'));
    render(<LensOverviewPage />);
    expect(await screen.findByText(/could not load observability metrics/i)).toBeInTheDocument();
  });
});
