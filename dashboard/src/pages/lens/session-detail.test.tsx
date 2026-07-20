import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Route, Routes, useSearchParams } from 'react-router-dom';
import { userEvent } from '@testing-library/user-event';
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

  it('drills into the trace detail when a session timeline row is clicked (M54 — the drill-down)', async () => {
    // The end-user report: on the session detail, clicking a trace must open that trace's detail
    // (session → trace → span). It navigates to the SAME trace-detail the traces list opens.
    mockCloudFetch.mockResolvedValue({
      traces: [{ traceId: 'tr-42', name: 'the-turn', startTimeUnixNano: '1000000000', durationMs: 5, costUsd: 0.01, totalTokens: 100, status: 'ok' }],
    });
    function TracesRouteProbe() {
      const [sp] = useSearchParams();
      return <div>traces-route trace={sp.get('trace')}</div>;
    }
    render(
      <Routes>
        <Route path="/observability/sessions/:sessionId" element={<LensSessionDetailPage />} />
        <Route path="/observability/traces" element={<TracesRouteProbe />} />
      </Routes>,
      { initialEntries: ['/observability/sessions/sess-abc'] },
    );
    const row = await screen.findByRole('button', { name: /the-turn/i });
    await userEvent.click(row);
    // navigated to the trace-detail route with this trace's id
    expect(await screen.findByText('traces-route trace=tr-42')).toBeInTheDocument();
  });

  it('M131 — shows the coherence verdict badge + reasoning and runs the judge on click', async () => {
    // URL-aware mock: the traces read + the coherence read/run are distinct endpoints.
    mockCloudFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).includes('/coherence')) {
        return opts?.method === 'POST'
          ? Promise.resolve({ verdict: 'incoherent', score: 0.2, reasoning: 'topic switch at turn 1', cached: false })
          : Promise.resolve({ verdict: null }); // not yet evaluated
      }
      return Promise.resolve({ traces: [{ traceId: 't1', name: 'x', startTimeUnixNano: '1000000000', durationMs: 5 }] });
    });
    renderAt('sess-abc');
    // initially not evaluated (the GET returned a null verdict)
    expect(await screen.findByText(/coherence: not evaluated/i)).toBeInTheDocument();
    // run the billable judge
    await userEvent.click(screen.getByRole('button', { name: /run coherence/i }));
    // the verdict badge (destructive) + the judge's turn-citing rationale appear
    expect(await screen.findByLabelText(/session coherence: incoherent/i)).toBeInTheDocument();
    expect(screen.getByTestId('coherence-reasoning')).toHaveTextContent('topic switch at turn 1');
  });

  // M132 — a URL-aware mock: the session traces read, the coherence read, and the per-trace tree read
  // are distinct endpoints. tr-1's tree carries FULL input/output.
  const mockConversation = (opts: { output?: string | null } = {}) =>
    mockCloudFetch.mockImplementation((url: string) => {
      const s = String(url);
      if (s.includes('session_id=')) {
        return Promise.resolve({ traces: [{ traceId: 'tr-1', name: 'turn one', startTimeUnixNano: '100' }] });
      }
      if (s.includes('/coherence')) return Promise.resolve({ verdict: null });
      if (s.includes('/traces/tr-1')) {
        return Promise.resolve({
          spanId: 's1',
          startTimeUnixNano: '100',
          endTimeUnixNano: '200',
          inputValue: 'the full user question',
          ...(opts.output === undefined ? { outputValue: 'the full assistant answer' } : {}),
        });
      }
      return Promise.resolve(null);
    });

  it('M132 — the Conversation tab replays each trace as a Human→AI turn with FULL text', async () => {
    mockConversation();
    renderAt('sess-abc');
    await screen.findByRole('tab', { name: /conversation/i });
    await userEvent.click(screen.getByRole('tab', { name: /conversation/i }));
    // full input + output render inline (not the 120-char preview)
    expect(await screen.findByText('the full user question')).toBeInTheDocument();
    expect(screen.getByText('the full assistant answer')).toBeInTheDocument();
  });

  it('M132 — ?tab=conversation opens the Conversation tab directly (deep-link)', async () => {
    mockConversation();
    render(
      <Routes>
        <Route path="/observability/sessions/:sessionId" element={<LensSessionDetailPage />} />
      </Routes>,
      { initialEntries: ['/observability/sessions/sess-abc?tab=conversation'] },
    );
    expect(await screen.findByText('the full user question')).toBeInTheDocument(); // conversation active on load
  });

  it('M132 — a turn with no output shows "(no output)", never a blank card', async () => {
    mockConversation({ output: null }); // tree has input but NO outputValue
    renderAt('sess-abc');
    await userEvent.click(await screen.findByRole('tab', { name: /conversation/i }));
    expect(await screen.findByText('the full user question')).toBeInTheDocument();
    expect(screen.getByText('(no output)')).toBeInTheDocument();
  });

  it('M132 (review HIGH/MED) — a >50-turn session caps at 50 turns + a "view all" link (earliest kept)', async () => {
    // 51 traces returned NEWEST-first (start desc) — the cap must keep the EARLIEST 50, not the latest.
    const many = Array.from({ length: 51 }, (_, i) => ({
      traceId: `tr-${i}`,
      startTimeUnixNano: String(1000 - i), // i=0 is newest (1000), i=50 is oldest (950)
    }));
    mockCloudFetch.mockImplementation((url: string) => {
      const s = String(url);
      if (s.includes('session_id=')) return Promise.resolve({ traces: many });
      if (s.includes('/coherence')) return Promise.resolve({ verdict: null });
      return Promise.resolve(null); // every per-trace tree → null (light: renders the load-fail affordance)
    });
    renderAt('sess-abc');
    await userEvent.click(await screen.findByRole('tab', { name: /conversation/i }));
    // exactly CONVERSATION_TURN_CAP (50) turn cards + the overflow link disclosing the true total.
    expect(await screen.findByText(/view all 51 traces/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('conversation-turn')).toHaveLength(50);
  });

  it('M132 (review MED) — a failed per-trace fetch shows "(could not load this turn)", others still render', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      const s = String(url);
      if (s.includes('session_id=')) {
        return Promise.resolve({ traces: [{ traceId: 'ok', startTimeUnixNano: '100' }, { traceId: 'bad', startTimeUnixNano: '200' }] });
      }
      if (s.includes('/coherence')) return Promise.resolve({ verdict: null });
      if (s.includes('/traces/ok')) return Promise.resolve({ spanId: 's', startTimeUnixNano: '100', endTimeUnixNano: '200', inputValue: 'ok input', outputValue: 'ok output' });
      return Promise.resolve(null); // /traces/bad → null (fetch failed)
    });
    renderAt('sess-abc');
    await userEvent.click(await screen.findByRole('tab', { name: /conversation/i }));
    expect(await screen.findByText('ok input')).toBeInTheDocument(); // the good turn renders
    expect(screen.getByText(/could not load this turn/i)).toBeInTheDocument(); // the failed one degrades gracefully
  });

  it('M132 (review MED) — a turn with no input shows "(no input)"', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      const s = String(url);
      if (s.includes('session_id=')) return Promise.resolve({ traces: [{ traceId: 'tr-1', startTimeUnixNano: '100' }] });
      if (s.includes('/coherence')) return Promise.resolve({ verdict: null });
      if (s.includes('/traces/tr-1')) return Promise.resolve({ spanId: 's', startTimeUnixNano: '100', endTimeUnixNano: '200', outputValue: 'only output' });
      return Promise.resolve(null);
    });
    renderAt('sess-abc');
    await userEvent.click(await screen.findByRole('tab', { name: /conversation/i }));
    expect(await screen.findByText('only output')).toBeInTheDocument();
    expect(screen.getByText('(no input)')).toBeInTheDocument();
  });

  // (M3 rate-limit coverage lives in the theo-lens api route test — session-coherence-routes.test.ts)
  it('M131 (review M1) — a failed coherence run surfaces an error, never a silent revert', async () => {
    mockCloudFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (String(url).includes('/coherence')) {
        return opts?.method === 'POST'
          ? Promise.reject(new Error('429 rate limited')) // billable run rejected
          : Promise.resolve({ verdict: null });
      }
      return Promise.resolve({ traces: [{ traceId: 't1', name: 'x', startTimeUnixNano: '1000000000', durationMs: 5 }] });
    });
    renderAt('sess-abc');
    await screen.findByText(/coherence: not evaluated/i);
    await userEvent.click(screen.getByRole('button', { name: /run coherence/i }));
    // fail-loud: the money-adjacent failure is visible (not a blind button revert)
    expect(await screen.findByTestId('coherence-run-error')).toBeInTheDocument();
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
