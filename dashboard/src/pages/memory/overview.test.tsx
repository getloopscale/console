// Plan 1 of dashboard-memory-section-roadmap.md, T1.6 acceptance.
// Focused on D3 absorption: empty pgvector → 0 not NaN.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 't', traits: { email: 'u@x.com' } },
  }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

import { MemoryPage } from './overview';

describe('MemoryPage (/memory landing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the 4 KPI tile labels + calls the metrics endpoint', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      total_memories: 42,
      retrieval_api_usage: 1000,
      add_events: 5,
      entity_count: 7,
    });
    render(<MemoryPage />);
    expect(await screen.findByText('Total memories')).toBeInTheDocument();
    expect(screen.getByText('Retrieval API calls')).toBeInTheDocument();
    expect(screen.getByText('Add events')).toBeInTheDocument();
    expect(screen.getByText('Distinct entities')).toBeInTheDocument();
    // Backend was hit at the canonical path — the value-rendering happy
    // path is exercised separately by the D3 empty-zero test below
    // (where the fallback guarantees zeros render without NaN).
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/memory/metrics',
      expect.anything(),
      expect.objectContaining({ throwOnError: true }),
    );
  });

  // dashboard-memory-error-surfacing T1.3 — metrics must NOT mask an outage as
  // fabricated zeros. On a backend error the error Alert renders and the KPI
  // tiles are absent (the live-test finding: app-dev 404 rendered 0/0/0/0).
  it('surfaces an error (no fake zeros) when the metrics backend fails', async () => {
    mockCloudFetch.mockRejectedValueOnce(new Error('backend 404'));
    render(<MemoryPage />);
    expect(await screen.findByText(/Could not load memory metrics/i)).toBeInTheDocument();
    expect(screen.queryByText('Total memories')).not.toBeInTheDocument();
    expect(screen.queryByText('Distinct entities')).not.toBeInTheDocument();
  });

  // dashboard-memory-error-surfacing /review fix (F-fe-1/F-fe-2) — the KPI strip
  // must render ONLY on a settled success, never during the loading/retry window.
  // Pre-fix the strip was gated on `!isError`, so while the query was still
  // pending (data undefined → `data ?? zeros`) it painted fabricated 0/0/0/0 —
  // the exact masking ADR D2 forbids. A never-resolving fetch keeps the query
  // pending so we can assert the zeros are absent and a loading affordance shows.
  it('does NOT render fabricated zeros while the metrics query is still pending', async () => {
    mockCloudFetch.mockReturnValueOnce(new Promise(() => {})); // never resolves → stays pending
    render(<MemoryPage />);
    // The Explore section always renders, so the page is mounted…
    expect(await screen.findByRole('heading', { name: /view graph/i })).toBeInTheDocument();
    // …but the KPI tiles (which would show "0") must be ABSENT during loading.
    expect(screen.queryByText('Total memories')).not.toBeInTheDocument();
    expect(screen.queryByText('Distinct entities')).not.toBeInTheDocument();
    // A loading affordance is shown in their place (skeleton, role=status).
    expect(screen.getByTestId('memory-metrics-loading')).toBeInTheDocument();
  });

  it('shows a "View Graph" explore card (themory-graph-gateway-dashboard)', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      total_memories: 1,
      retrieval_api_usage: 0,
      add_events: 0,
      entity_count: 0,
    });
    render(<MemoryPage />);
    // ExploreCard renders the title as a heading (navigation is via the card's
    // Open button → window.location). Assert the Graph card is present.
    expect(await screen.findByRole('heading', { name: /view graph/i })).toBeInTheDocument();
  });

  it('D3 absorption — empty pgvector renders 0 everywhere, not NaN', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      total_memories: 0,
      retrieval_api_usage: 0,
      add_events: 0,
      entity_count: 0,
    });
    render(<MemoryPage />);
    // Wait for the first KPI label to render — guarantees the query resolved.
    expect(await screen.findByText('Total memories')).toBeInTheDocument();
    // Crucial regression guard: not a single "NaN" in the rendered output.
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
    // Each tile shows "0" (MetricCard value can render the same number 0 in
    // multiple places — assert presence, not count).
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(4);
  });

  it('T2.4 — renders the 4 Explore cards (Customize / Integration / Playground / Documentation)', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      total_memories: 0,
      retrieval_api_usage: 0,
      add_events: 0,
      entity_count: 0,
    });
    render(<MemoryPage />);
    expect(await screen.findByText('Total memories')).toBeInTheDocument();
    expect(screen.getByText('Customize')).toBeInTheDocument();
    expect(screen.getByText('Integration examples')).toBeInTheDocument();
    expect(screen.getByText('Try Playground')).toBeInTheDocument();
    expect(screen.getByText('Documentation')).toBeInTheDocument();
  });

  it('Refresh button re-fetches metrics', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      total_memories: 1,
      retrieval_api_usage: 0,
      add_events: 0,
      entity_count: 0,
    });
    const user = userEvent.setup();
    render(<MemoryPage />);
    expect(await screen.findByText('Total memories')).toBeInTheDocument();

    mockCloudFetch.mockResolvedValueOnce({
      total_memories: 2,
      retrieval_api_usage: 0,
      add_events: 0,
      entity_count: 0,
    });
    await user.click(screen.getByRole('button', { name: /refresh/i }));
    // After invalidation, the query refetches → mockCloudFetch called again.
    expect(mockCloudFetch).toHaveBeenCalledTimes(2);
  });
});
