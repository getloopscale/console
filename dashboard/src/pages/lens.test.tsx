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
    if (url.includes('cost')) return Promise.resolve({ buckets: [{ costUsd: 1.25 }, { costUsd: 0.25 }] });
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
    expect(await screen.findByText('10')).toBeInTheDocument(); // 8 + 2 traces
    expect(screen.getByText('Error rate %')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument(); // 2/10
    expect(screen.getByText('Latency p95 (ms)')).toBeInTheDocument();
    for (const t of ['Traces', 'Sessions', 'Datasets', 'Evaluators', 'Guards', 'Agents', 'Ask']) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('button', { name: /open →/i }).length).toBeGreaterThanOrEqual(7);
  });

  it('renders the four trend charts (M51)', async () => {
    seriesMock();
    render(<LensOverviewPage />);
    await screen.findByText('Throughput (traces)'); // data-gated barrier
    for (const title of ['Throughput (traces)', 'Error rate (%)', 'Latency (ms)', 'Cost by model (USD)']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // charts drew SVG lines (throughput 1 + error 1 + latency 3 + cost-by-model 2 = 7)
    expect(screen.getAllByTestId('trend-line').length).toBeGreaterThanOrEqual(6);
  });

  it('the by-model cost chart draws one line per model', async () => {
    seriesMock();
    render(<LensOverviewPage />);
    const costChart = (await screen.findByText('Cost by model (USD)')).closest('figure') as HTMLElement;
    expect(costChart.querySelectorAll('[data-testid="trend-line"]')).toHaveLength(2); // opus + haiku
  });

  it('the range selector re-fetches server-side with ?range= (no client re-bucket)', async () => {
    seriesMock();
    render(<LensOverviewPage />);
    await screen.findByText('Throughput (traces)');
    // initial fetch uses the 24h default
    expect(obsUrls().some((u) => u.includes('range=24h'))).toBe(true);
    await userEvent.click(screen.getByRole('combobox', { name: /time range/i }));
    await userEvent.click(await screen.findByRole('option', { name: /last 7 days/i }));
    await waitFor(() => expect(obsUrls().some((u) => u.includes('range=7d'))).toBe(true));
  });

  it('shows an empty-state chart when a series has no data (not a zero line)', async () => {
    seriesMock({ traffic: [], latency: [], tokensByModel: [] });
    render(<LensOverviewPage />);
    await screen.findByText('Throughput (traces)'); // the title renders even in the empty-state
    // every chart renders its empty-state; none draws a line
    expect(screen.getAllByTestId('trend-empty').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByTestId('trend-line')).not.toBeInTheDocument();
  });

  it('shows a warning Alert when the metrics fail to load', async () => {
    mockCloudFetch.mockRejectedValue(new Error('boom'));
    render(<LensOverviewPage />);
    expect(await screen.findByText(/could not load observability metrics/i)).toBeInTheDocument();
  });
});
