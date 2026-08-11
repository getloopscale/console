import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { RagOverviewPage } from './overview';

const ANALYTICS = {
  window: { since: '2026-07-01T00:00:00Z' },
  totals: { retrievals: 7, answers: 3, empty_retrieval_rate: 0.2 },
  latency: { p50_ms: 40, p95_ms: 120 },
  confidence: { high: 2, medium: 1, low: 0 },
};

describe('RagOverviewPage (/rag)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the KPI strip + Getting started + Explore cards on success', async () => {
    mockCloudFetch.mockResolvedValue(ANALYTICS);
    render(<RagOverviewPage />);

    // KPI strip from /v1/dashboard/rag/analytics
    expect(await screen.findByText('7')).toBeInTheDocument(); // retrievals
    expect(screen.getByText('Retrievals')).toBeInTheDocument();
    expect(screen.getByText('Answers')).toBeInTheDocument();

    // Getting started + Explore grid to every sub-page (the coherence fix)
    expect(screen.getByText('Getting started')).toBeInTheDocument();
    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Collections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ask' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
  });

  it('shows a warning (not destructive) alert when metrics fail to load', async () => {
    mockCloudFetch.mockRejectedValue(new Error('service down'));
    render(<RagOverviewPage />);
    // Explore cards still render (browsing is not blocked); a warning alert surfaces.
    expect(await screen.findByText('Could not load RAG metrics')).toBeInTheDocument();
    expect(screen.getByText('Explore')).toBeInTheDocument();
  });
});

describe('the chart under the counts (B-129)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows how the answers were distributed by confidence', async () => {
    // The counts say HOW MUCH; the distribution says WHAT KIND. `3 answers` reads the same whether
    // all three were confident or none were — and that difference is the one a RAG operator acts on.
    mockCloudFetch.mockResolvedValue(ANALYTICS);
    render(<RagOverviewPage />);

    const chart = await screen.findByRole('table', { name: /answer confidence/i });
    expect(within(chart).getByRole('row', { name: /high\s*2/i })).toBeInTheDocument();
    expect(within(chart).getByRole('row', { name: /low\s*0/i }), 'a zero bucket must still show').toBeInTheDocument();
  });

  it('a read that FAILED draws no chart', async () => {
    // Three empty bars over a failed read are a fabricated distribution standing where an error
    // belongs — the same rule the KPI cards follow one row above.
    mockCloudFetch.mockRejectedValue(new Error('service down'));
    render(<RagOverviewPage />);

    await screen.findByText('Could not load RAG metrics');
    expect(screen.queryByRole('table', { name: /answer confidence/i })).not.toBeInTheDocument();
  });
});
