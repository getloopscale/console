import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensOverviewPage } from './lens';

describe('LensOverviewPage (/lens Overview landing)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the KPI strip aggregated from observability + cost, and the Explore grid', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url.includes('observability')) {
        return Promise.resolve({
          traffic: [
            { traceCount: 8, errorCount: 2 },
            { traceCount: 2, errorCount: 0 },
          ],
          latency: [{ p95Ms: 1234 }],
        });
      }
      if (url.includes('cost')) {
        return Promise.resolve({ buckets: [{ costUsd: 1.25 }, { costUsd: 0.25 }] });
      }
      return Promise.resolve({});
    });

    render(<LensOverviewPage />);

    // KPI tiles: 10 traces total, 20% error rate, p95 1234, cost $1.50
    expect(await screen.findByText('Traces (24h)')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Error rate %')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('Latency p95 (ms)')).toBeInTheDocument();

    // Explore grid — all 8 sub-page cards
    for (const t of ['Traces', 'Sessions', 'Datasets', 'Evaluators', 'Guards', 'Agents', 'Ask', 'Analytics']) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    }
    // At least 8 "Open →" destination buttons (one per Explore card)
    expect(screen.getAllByRole('button', { name: /open →/i }).length).toBeGreaterThanOrEqual(8);
  });

  it('shows a warning Alert when the metrics fail to load', async () => {
    mockCloudFetch.mockRejectedValue(new Error('boom'));
    render(<LensOverviewPage />);
    expect(await screen.findByText(/could not load lens metrics/i)).toBeInTheDocument();
  });
});
