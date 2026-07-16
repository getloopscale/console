import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensSessionDetailPage } from './session-detail';

/**
 * M9 — /observability/sessions/:sessionId. The detail page fetches the session's traces
 * (`GET /v1/dashboard/lens/traces?session_id=<id>`), maps them to `SessionTraceItem[]`, and renders
 * the `@usetheo/ui` `SessionSummary` (aggregate metrics) + `SessionTimeline` (temporal replay). Tests
 * cover the loading→error→empty→loaded triad, the fetch shape, and the back link.
 */
describe('LensSessionDetailPage (/observability/sessions/:sessionId)', () => {
  beforeEach(() => vi.clearAllMocks());

  // The page reads `:sessionId` via useParams — mount it under a matching Route so the param resolves
  // (mirrors production `/observability/sessions/:sessionId` registered in app.tsx).
  const renderAt = (sessionId: string) =>
    render(
      <Routes>
        <Route path="/observability/sessions/:sessionId" element={<LensSessionDetailPage />} />
      </Routes>,
      { initialEntries: [`/observability/sessions/${sessionId}`] },
    );

  it('fetches the traces for the URL session id (session_id= query param)', async () => {
    mockCloudFetch.mockResolvedValue({ traces: [{ traceId: 't1', startTimeUnixNano: '1000000000', durationMs: 5 }] });
    renderAt('sess-abc');
    await screen.findByText(/sess-abc/i);
    expect(
      mockCloudFetch.mock.calls.some((c) => String(c[0]).includes('session_id=sess-abc')),
    ).toBe(true);
  });

  it('renders the SessionSummary metrics + the SessionTimeline replay when traces load', async () => {
    mockCloudFetch.mockResolvedValue({
      traces: [
        { traceId: 't1', name: 'first', startTimeUnixNano: '1000000000', durationMs: 5, costUsd: 0.01, totalTokens: 100, status: 'ok' },
        { traceId: 't2', name: 'second', startTimeUnixNano: '2000000000', durationMs: 3, costUsd: 0.02, totalTokens: 200, status: 'error' },
      ],
    });
    renderAt('sess-abc');
    // SessionSummary is a <dl> of aggregate metrics — the trace count (2) is disclosed.
    expect(await screen.findByText(/first/i)).toBeInTheDocument(); // a timeline row name
    expect(screen.getByText(/second/i)).toBeInTheDocument();
    // ∑ tokens = 300 across the two traces (aggregated by the DS component). Exact-match so the
    // $0.0300 cost cell (which also contains "300") does not satisfy the assertion.
    expect(screen.getByText('300')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the fetch is in flight', () => {
    mockCloudFetch.mockReturnValue(new Promise(() => {})); // never resolves
    renderAt('sess-abc');
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('shows an Alert when the fetch fails', async () => {
    mockCloudFetch.mockRejectedValue(new Error('boom'));
    renderAt('sess-abc');
    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
  });

  it('shows an EmptyState when the session has no traces', async () => {
    mockCloudFetch.mockResolvedValue({ traces: [] });
    renderAt('sess-abc');
    expect(await screen.findByText('No traces in this session')).toBeInTheDocument();
  });

  it('offers a back link to the sessions list', async () => {
    mockCloudFetch.mockResolvedValue({ traces: [] });
    renderAt('sess-abc');
    const back = await screen.findByRole('link', { name: /sessions/i });
    expect(back).toHaveAttribute('href', '/observability/sessions');
  });
});
