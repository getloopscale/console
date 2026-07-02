import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { RagAnalyticsPage } from './analytics';

describe('RagAnalyticsPage (/rag/analytics)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the M5 summary metrics from the BFF', async () => {
    mockCloudFetch.mockResolvedValue({
      window: { since: '2026-07-01' },
      totals: { retrievals: 12, answers: 7, empty_retrieval_rate: 0.1 },
      latency: { p50_ms: 40, p95_ms: 120 },
      confidence: { high: 5, medium: 1, low: 1 },
    });
    render(<RagAnalyticsPage />);
    expect(await screen.findByText('12')).toBeInTheDocument(); // retrievals
    expect(screen.getByText('7')).toBeInTheDocument(); // answers
    expect(mockCloudFetch).toHaveBeenCalledWith('/v1/dashboard/rag/analytics');
  });

  it('renders an error alert when the BFF is unavailable', async () => {
    mockCloudFetch.mockResolvedValue(null);
    render(<RagAnalyticsPage />);
    expect(await screen.findByText(/could not load analytics/i)).toBeInTheDocument();
  });
});
