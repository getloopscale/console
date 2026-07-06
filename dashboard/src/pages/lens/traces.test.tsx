import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { within, waitFor, render as rtlRender, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, Toaster, violetForge } from '@usetheo/ui';
import { PageMetaProvider } from '@/hooks/use-page-meta';
import { render, screen } from '@/test/render';

// URL-init isolation: nuqs's real router-adapter shares a module-level throttle queue across tests
// (a write in one test can bleed into the next). For tests that assert "given searchParams X, the
// component reads X" we use nuqs's official testing adapter, which is isolated per render — the
// documented tool for exactly this (production URL round-trip is proven separately by real usage).
function renderWithParams(ui: React.ReactElement, searchParams: string): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } });
  return rtlRender(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <ThemeProvider themes={[violetForge]} defaultTheme="violet-forge" defaultMode="dark">
          <Toaster>
            {/* MemoryRouter so the component's react-router useSearchParams (M52 saved-view apply)
                has a Router; NuqsTestingAdapter isolates the nuqs filter state. Both start at the
                same search string, so they stay consistent. */}
            <MemoryRouter initialEntries={[`/observability/traces${searchParams}`]}>
              <NuqsTestingAdapter searchParams={searchParams}>
                <PageMetaProvider>{children}</PageMetaProvider>
              </NuqsTestingAdapter>
            </MemoryRouter>
          </Toaster>
        </ThemeProvider>
      </QueryClientProvider>
    ),
  });
}

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));
const mockTriggerDownload = vi.fn();
vi.mock('@/lib/download', () => ({ triggerDownload: (...a: unknown[]) => mockTriggerDownload(...a) }));

// Mock the M48 trace-detail's layout lib (jsdom cannot lay it out — see trace-detail.test.tsx).
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: (props: Record<string, unknown>) => <div role="separator" {...props} />,
}));

import { LensTracesPage, buildTraceQuery, nsToIso } from './traces';
import { formatDate } from '@/lib/format';

// M49 — list-vs-detail-vs-tags URL discriminator. The list read is the base path optionally
// followed by `?<filters>`; the detail read is base + `/<id>`; tags/annotations contain `/tags`.
const BASE = '/v1/dashboard/lens/traces';
const isListUrl = (url: string) => url === BASE || url.startsWith(`${BASE}?`);
function filterMock(traces: unknown[]) {
  mockCloudFetch.mockImplementation((url: string) => {
    if (isListUrl(url)) return Promise.resolve({ traces });
    if (url.includes('/tags')) return Promise.resolve({ tags: [] });
    return Promise.resolve({});
  });
}
const listUrls = () => mockCloudFetch.mock.calls.map((c) => c[0] as string).filter(isListUrl);

function routeMock() {
  mockCloudFetch.mockImplementation((url: string) => {
    if (url === '/v1/dashboard/lens/traces') return Promise.resolve({ traces: [{ traceId: 'tr_1', name: 'checkout' }] });
    if (url.includes('/tags')) return Promise.resolve({ tags: ['prod'] });
    return Promise.resolve({});
  });
}

describe('LensTracesPage (/observability/traces)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists traces', async () => {
    routeMock();
    render(<LensTracesPage />);
    expect(await screen.findByText('tr_1')).toBeInTheDocument();
  });

  it('M54 — the Compare action is enabled only when exactly two traces are selected', async () => {
    filterMock([
      { traceId: 'tr_1', name: 'a' },
      { traceId: 'tr_2', name: 'b' },
      { traceId: 'tr_3', name: 'c' },
    ]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');

    const compare = screen.getByRole('button', { name: /compare/i });
    expect(compare).toBeDisabled(); // 0 selected

    await userEvent.click(screen.getByLabelText('Select tr_1 for compare'));
    expect(compare).toBeDisabled(); // 1 selected — still disabled

    await userEvent.click(screen.getByLabelText('Select tr_2 for compare'));
    expect(compare).toBeEnabled(); // exactly 2 → enabled
    expect(compare).toHaveAttribute('data-compare-href', '/observability/compare?ids=tr_1,tr_2');

    await userEvent.click(screen.getByLabelText('Select tr_3 for compare'));
    expect(compare).toBeDisabled(); // 3 selected → disabled again (compare is pairwise)
  });

  it('M56 — Export CSV downloads the filtered set (WYSIWYG) + discloses the count', async () => {
    mockTriggerDownload.mockClear();
    filterMock([{ traceId: 'tr_1', name: 'checkout' }, { traceId: 'tr_2', name: 'refund' }]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(mockTriggerDownload).toHaveBeenCalled());
    const [filename, content, mime] = mockTriggerDownload.mock.calls.at(-1)!;
    expect(String(filename)).toMatch(/\.csv$/);
    expect(String(mime)).toContain('text/csv');
    expect(String(content)).toContain('tr_1'); // the filtered rows are in the file
    // WYSIWYG: the export fetch carried the list query with limit/offset paging
    expect(mockCloudFetch.mock.calls.some(([u]) => String(u).includes('limit=500&offset=0'))).toBe(true);
    expect(await screen.findByTestId('export-disclosure')).toHaveTextContent(/Exported 2 traces/i);
  });

  it('M56 — Export JSON downloads a .json of the raw records', async () => {
    mockTriggerDownload.mockClear();
    filterMock([{ traceId: 'tr_1', name: 'checkout' }]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(screen.getByRole('button', { name: /export json/i }));
    await waitFor(() => expect(mockTriggerDownload).toHaveBeenCalled());
    const [filename, content, mime] = mockTriggerDownload.mock.calls.at(-1)!;
    expect(String(filename)).toMatch(/\.json$/);
    expect(String(mime)).toContain('application/json');
    expect(JSON.parse(String(content))[0].traceId).toBe('tr_1');
  });

  it('M56 — Export is omitted when the filtered set is empty', async () => {
    filterMock([]);
    render(<LensTracesPage />);
    await screen.findByText(/no traces/i);
    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument();
  });

  it('M56 — a failed export surfaces a typed error, not a silent no-op (no download)', async () => {
    mockTriggerDownload.mockClear();
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === BASE) return Promise.resolve({ traces: [{ traceId: 'tr_1', name: 'checkout' }] }); // the list loads
      if (isListUrl(url)) return Promise.reject(new Error('export 5xx')); // the paged export fetch fails
      return Promise.resolve({});
    });
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(screen.getByTestId('export-error')).toBeInTheDocument());
    expect(mockTriggerDownload).not.toHaveBeenCalled();
  });

  it('adds a tag via POST {tag} after opening a trace', async () => {
    routeMock();
    render(<LensTracesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /open tr_1/i }));
    await userEvent.type(await screen.findByLabelText(/new tag/i), 'canary');
    await userEvent.click(screen.getByRole('button', { name: /add tag/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/traces/tr_1/tags',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ tag: 'canary' }) }),
    );
  });

  it('remove-tag opens ConfirmDialog then calls DELETE ?tag= on confirm', async () => {
    routeMock();
    render(<LensTracesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /open tr_1/i }));
    await userEvent.click(await screen.findByRole('button', { name: /remove tag prod/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^remove tag$/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/traces/tr_1/tags?tag=prod',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('opening a trace shows the span tree AND keeps the tags/annotations forms (M47, no regression)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url === '/v1/dashboard/lens/traces') return Promise.resolve({ traces: [{ traceId: 'tr_1', name: 'checkout' }] });
      if (url === '/v1/dashboard/lens/traces/tr_1')
        return Promise.resolve({ spanId: 's0', traceId: 'tr_1', name: 'checkout.root', children: [] });
      if (url.includes('/tags')) return Promise.resolve({ tags: ['prod'] });
      return Promise.resolve({});
    });
    render(<LensTracesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /open tr_1/i }));
    // span tree renders (M47)
    const treeEl = await screen.findByTestId('span-tree');
    expect(within(treeEl).getByText('checkout.root')).toBeInTheDocument();
    // AND the M44 tags/annotations forms are preserved
    expect(screen.getByLabelText(/new tag/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new annotation/i)).toBeInTheDocument();
    // the M47 tree fetch is GET-only — opening a trace makes zero mutating calls
    const mutating = mockCloudFetch.mock.calls.filter((c) => {
      const m = (c[1] as { method?: string })?.method;
      return m === 'POST' || m === 'DELETE' || m === 'PUT' || m === 'PATCH';
    });
    expect(mutating).toHaveLength(0);
  });
});

describe('buildTraceQuery (M49/M52 — pure filter→querystring mapping)', () => {
  const NOW = Date.UTC(2026, 6, 4, 12, 0, 0); // fixed clock, injected — deterministic
  // Fill the required TraceFilters fields; a test overrides only what it exercises.
  const bf = (o: Partial<Parameters<typeof buildTraceQuery>[0]>) =>
    buildTraceQuery(
      { q: '', status: 'all', model: '', range: 'all', costMin: '', costMax: '', tokensMin: '', tokensMax: '', session: '', ...o },
      NOW,
    );

  it('emits an empty string when no filter is active', () => {
    expect(bf({})).toBe('');
  });

  it('trims and forwards a non-empty search term as q=', () => {
    expect(bf({ q: '  boom  ' })).toBe('?q=boom');
  });

  it('forwards status only when it is error (all is the sentinel for "no filter")', () => {
    expect(bf({ status: 'error' })).toBe('?status=error');
  });

  it('forwards a selected model and omits an empty one', () => {
    expect(bf({ model: 'claude-opus-4-8' })).toContain('model=claude-opus-4-8');
    expect(bf({})).not.toContain('model=');
  });

  it('maps a time range to a from= ISO timestamp computed from the injected clock', () => {
    const from = new URLSearchParams(bf({ range: '1h' }).slice(1)).get('from');
    expect(from).toBe(new Date(NOW - 3_600_000).toISOString());
  });

  it('omits from= when the range is "all"', () => {
    expect(bf({})).not.toContain('from=');
  });

  it('forwards the advanced filters as theo-lens snake_case params (M52)', () => {
    const qs = bf({ costMin: '0.1', costMax: '5', tokensMin: '100', tokensMax: '9000', session: 'sess-x' });
    const p = new URLSearchParams(qs.slice(1));
    expect(p.get('min_cost_usd')).toBe('0.1');
    expect(p.get('max_cost_usd')).toBe('5');
    expect(p.get('min_tokens')).toBe('100');
    expect(p.get('max_tokens')).toBe('9000');
    expect(p.get('session_id')).toBe('sess-x');
  });

  it('omits an empty advanced filter (M52)', () => {
    expect(bf({ costMin: '1' })).not.toContain('max_cost_usd=');
    expect(bf({})).not.toContain('session_id=');
  });

  // M59 P0 (D1) — behavior-preservation guard for the traces.tsx decomposition: the full-filter
  // output string is byte-identical for a fixed filter set + fixed clock. If the Phase 0 extraction
  // (columns.tsx + saved-views.tsx) ever accidentally moved/altered buildTraceQuery, this pins it.
  it('M59 P0 — is byte-identical for a fixed full filter set + fixed clock (decomposition guard)', () => {
    const out = buildTraceQuery(
      {
        q: 'boom',
        status: 'error',
        model: 'claude-opus-4-8',
        range: '1h',
        costMin: '0.1',
        costMax: '5',
        tokensMin: '100',
        tokensMax: '9000',
        session: 'sess-x',
      },
      NOW,
    );
    const from = new Date(NOW - 3_600_000).toISOString();
    expect(out).toBe(
      `?q=boom&status=error&model=claude-opus-4-8&from=${encodeURIComponent(from)}` +
        '&min_cost_usd=0.1&max_cost_usd=5&min_tokens=100&max_tokens=9000&session_id=sess-x',
    );
  });
});

describe('LensTracesPage — M49 search & filters (wiring)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT send q= / status= on the initial unfiltered load (negative case)', async () => {
    filterMock([{ traceId: 'tr_1', name: 'checkout' }]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    // the very first list read is the bare path — no filter params leak in
    expect(listUrls()[0]).toBe(BASE);
    expect(listUrls().every((u) => !u.includes('q='))).toBe(true);
  });

  it('typing a search term narrows the list with q= server-side', async () => {
    filterMock([{ traceId: 'tr_1', name: 'checkout' }]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.type(screen.getByLabelText(/search traces/i), 'canary');
    await waitFor(() => expect(listUrls().some((u) => u.includes('q=canary'))).toBe(true));
  });

  it('debounces the search box — rapid typing coalesces into a single q= term (no per-keystroke fetch)', async () => {
    filterMock([{ traceId: 'tr_1', name: 'checkout' }]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.type(screen.getByLabelText(/search traces/i), 'canary');
    await waitFor(() => expect(listUrls().some((u) => u.includes('q=canary'))).toBe(true));
    // the debounce coalesces the 6 keystrokes: every q-bearing fetch is the FINAL term —
    // there is no intermediate q=c / q=ca / … fetch (which a per-keystroke fetch would produce).
    const qFetches = listUrls().filter((u) => u.includes('q='));
    expect(qFetches.every((u) => u.includes('q=canary'))).toBe(true);
  });

  it('selecting "Errors only" narrows the list with status=error', async () => {
    filterMock([{ traceId: 'tr_1', name: 'checkout', statusCode: 'error' }]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(screen.getByRole('combobox', { name: /filter by status/i }));
    await userEvent.click(await screen.findByRole('option', { name: /errors only/i }));
    await waitFor(() => expect(listUrls().some((u) => /[?&]status=error(&|$)/.test(u))).toBe(true));
  });

  it('selecting a model narrows the list with model=', async () => {
    filterMock([{ traceId: 'tr_1', name: 'checkout', model: 'claude-opus-4-8' }]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(screen.getByRole('combobox', { name: /filter by model/i }));
    await userEvent.click(await screen.findByRole('option', { name: 'claude-opus-4-8' }));
    await waitFor(() => expect(listUrls().some((u) => u.includes('model=claude-opus-4-8'))).toBe(true));
  });

  it('selecting a time range narrows the list with from=', async () => {
    filterMock([{ traceId: 'tr_1', name: 'checkout' }]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(screen.getByRole('combobox', { name: /filter by time range/i }));
    await userEvent.click(await screen.findByRole('option', { name: /last hour/i }));
    await waitFor(() => expect(listUrls().some((u) => u.includes('from='))).toBe(true));
  });

  it('round-trips ?q= from the URL: initializes the search box AND the first fetch', async () => {
    filterMock([{ traceId: 'tr_1', name: 'checkout' }]);
    renderWithParams(<LensTracesPage />, '?q=boom');
    await screen.findByText('tr_1');
    expect(screen.getByLabelText(/search traces/i)).toHaveValue('boom');
    expect(listUrls().some((u) => u.includes('q=boom'))).toBe(true);
  });

  it('shows a filter-specific empty state when an active filter matches nothing', async () => {
    filterMock([]); // upstream returns zero rows for the filtered query
    renderWithParams(<LensTracesPage />, '?status=error');
    expect(await screen.findByText(/no traces match these filters/i)).toBeInTheDocument();
  });
});

// M52 — advanced filters + saved views. A mock handling the traces list + the saved-views CRUD.
function m52Mock(opts: { traces?: unknown[]; views?: Array<{ id: string; name: string; query_string: string }> } = {}) {
  const SV = '/v1/dashboard/lens/saved-views';
  mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (isListUrl(url)) return Promise.resolve({ traces: opts.traces ?? [{ traceId: 'tr_1', name: 'checkout' }] });
    if (url === SV && (!init || init.method === undefined || init.method === 'GET'))
      return Promise.resolve({ saved_views: opts.views ?? [] });
    if (url === SV && init?.method === 'POST') return Promise.resolve({ id: 'lsv-new', name: 'x', query_string: '?status=error' });
    if (url.startsWith(`${SV}/`) && init?.method === 'DELETE') return Promise.resolve({});
    if (url.includes('/tags')) return Promise.resolve({ tags: [] });
    return Promise.resolve({});
  });
}
const svCalls = (method: string) =>
  mockCloudFetch.mock.calls.filter(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes('/saved-views') && (c[1] as { method?: string })?.method === method,
  );

describe('LensTracesPage — M52 advanced filters + saved views', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a cost-min advanced filter narrows the list server-side (min_cost_usd=)', async () => {
    m52Mock({});
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.type(screen.getByLabelText(/minimum cost usd/i), '0.1');
    await waitFor(() => expect(listUrls().some((u) => u.includes('min_cost_usd=0.1'))).toBe(true));
  });

  it('a session advanced filter narrows the list server-side (session_id=)', async () => {
    m52Mock({});
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.type(screen.getByLabelText(/filter by session id/i), 'sess-x');
    await waitFor(() => expect(listUrls().some((u) => u.includes('session_id=sess-x'))).toBe(true));
  });

  it('lists saved views and applies one (pushes its query string → server re-fetches)', async () => {
    m52Mock({ views: [{ id: 'lsv-1', name: 'errored opus', query_string: '?status=error&model=claude-opus-4-8' }] });
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(await screen.findByRole('button', { name: /apply view errored opus/i }));
    await waitFor(() => expect(listUrls().some((u) => u.includes('status=error') && u.includes('model=claude-opus-4-8'))).toBe(true));
  });

  it('saves the current filter combination as a named view (POST name + query_string)', async () => {
    m52Mock({});
    render(<LensTracesPage />, { initialEntries: ['/observability/traces?status=error'] });
    await screen.findByText('tr_1');
    await userEvent.click(screen.getByRole('button', { name: /save current view/i }));
    await userEvent.type(screen.getByLabelText(/saved view name/i), 'my errors');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(svCalls('POST').length).toBe(1));
    const body = JSON.parse((svCalls('POST')[0][1] as { body: string }).body);
    expect(body.name).toBe('my errors');
    expect(body.query_string).toContain('status=error'); // the current filter URL is the view
  });

  it('deletes a saved view after confirmation (DELETE)', async () => {
    m52Mock({ views: [{ id: 'lsv-9', name: 'junk', query_string: '?q=x' }] });
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(await screen.findByRole('button', { name: /delete view junk/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^delete view$/i }));
    await waitFor(() => expect(svCalls('DELETE').length).toBe(1));
    expect(svCalls('DELETE')[0][0]).toContain('/saved-views/lsv-9');
  });

  it('save is disabled until a view name is entered (negative)', async () => {
    m52Mock({});
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(screen.getByRole('button', { name: /save current view/i }));
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  // M57 T1.1/T1.2 — timestamp column + short/copyable id.
  const LONG_ID = 'dbbbfe6f3fda53662c57ef875f0191f8';
  const NS = '1767225600000000000'; // 2026-01-01T00:00:00Z in ns

  it('renders a Time column with a relative value and an absolute-time title (T1.1)', async () => {
    filterMock([{ traceId: LONG_ID, name: 'a', startTimeUnixNano: NS }]);
    render(<LensTracesPage />);
    await screen.findByText('dbbbfe6f…');
    // header present
    expect(screen.getByText('Time')).toBeInTheDocument();
    // the absolute datetime is exposed via the cell's title (self-consistent with the helper)
    const iso = nsToIso(NS)!;
    expect(screen.getByTitle(formatDate(iso, 'datetime'))).toBeInTheDocument();
  });

  it('renders "—" in the Time column when startTimeUnixNano is missing (edge)', async () => {
    filterMock([{ traceId: LONG_ID, name: 'a' }]);
    render(<LensTracesPage />);
    await screen.findByText('dbbbfe6f…');
    // no title for a missing timestamp (the cell is the em-dash)
    expect(screen.queryByTitle(/2026|2025/)).not.toBeInTheDocument();
  });

  it('truncates the trace id and offers a full-id copy control (T1.2)', async () => {
    filterMock([{ traceId: LONG_ID, name: 'a', startTimeUnixNano: NS }]);
    render(<LensTracesPage />);
    // display is truncated (8-char prefix + ellipsis), never the raw 32-hex
    expect(await screen.findByText('dbbbfe6f…')).toBeInTheDocument();
    expect(screen.queryByText(LONG_ID)).not.toBeInTheDocument();
    // a copy control is present (carries the full id at the call site, ADR-D4)
    expect(screen.getByRole('button', { name: /copy trace id/i })).toBeInTheDocument();
  });

  it('orders rows newest-first by startTimeUnixNano regardless of fetch order (T1.1)', async () => {
    // Deliberately out-of-order fetch: mid, newest, oldest.
    filterMock([
      { traceId: 'tr_mid', name: 'mid', startTimeUnixNano: '2000000000000000000' },
      { traceId: 'tr_new', name: 'new', startTimeUnixNano: '3000000000000000000' },
      { traceId: 'tr_old', name: 'old', startTimeUnixNano: '1000000000000000000' },
    ]);
    render(<LensTracesPage />);
    const newCell = await screen.findByText('new');
    const oldCell = screen.getByText('old');
    // 'new' precedes 'old' in the DOM → rendered newest-first.
    expect(newCell.compareDocumentPosition(oldCell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('nsToIso (M57 T1.1)', () => {
  it('converts a nanosecond string to an ISO instant', () => {
    expect(nsToIso('1767225600000000000')).toBe('2026-01-01T00:00:00.000Z');
  });
  it('returns null for nullish / zero / non-numeric input', () => {
    expect(nsToIso(undefined)).toBeNull();
    expect(nsToIso(null)).toBeNull();
    expect(nsToIso('')).toBeNull();
    expect(nsToIso('0')).toBeNull();
    expect(nsToIso('not-a-number')).toBeNull();
  });
});
