import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { RagOverviewPage } from './rag';

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
