import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { within, waitFor, render as rtlRender, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from '@getloopscale/ui';
import { ThemeProvider } from '@getloopscale/loopzero-ui';
import { TEMA_LOOPSCALE } from '@/lib/theme/loopscale-theme';
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
        <ThemeProvider {...TEMA_LOOPSCALE}>
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
vi.mock('@/lib/http/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));
const mockTriggerDownload = vi.fn();
vi.mock('@/lib/export/download', () => ({ triggerDownload: (...a: unknown[]) => mockTriggerDownload(...a) }));

// Mock the M48 trace-detail's layout lib (jsdom cannot lay it out — see trace-detail.test.tsx).
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: (props: Record<string, unknown>) => <div role="separator" {...props} />,
}));

import { LensTracesPage, buildTraceQuery, nsToIso } from './traces';
import { formatDate } from '@/lib/formatting/format';
import { isPath } from '@/test/url';

// M49 — list-vs-detail-vs-tags URL discriminator. The list read is the base path optionally
// followed by `?<filters>`; the detail read is base + `/<id>`; tags/annotations contain `/tags`.
const BASE = '/v1/dashboard/lens/traces';
const isListUrl = (url: string) => isPath(url, BASE) || url.startsWith(`${BASE}?`);
function filterMock(traces: unknown[]) {
  mockCloudFetch.mockImplementation((url: string) => {
    if (isListUrl(url)) return Promise.resolve({ traces });
    if (url.includes('/tags')) return Promise.resolve({ tags: [] });
    return Promise.resolve({});
  });
}
const listUrls = () => mockCloudFetch.mock.calls.map((c) => c[0] as string).filter(isListUrl);

// M59 P2 — drive the chip-filter builder: Add-filter Select → pick column option ("status is",
// "cost >=", …) → (type value into the Input | keep the enum Select default) → Apply.
async function addChip(optionName: RegExp, opts: { value?: string; valueLabel?: RegExp } = {}) {
  await userEvent.click(screen.getByRole('combobox', { name: /add filter/i }));
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
  if (opts.value !== undefined && opts.valueLabel) {
    await userEvent.type(screen.getByRole('textbox', { name: opts.valueLabel }), opts.value);
  }
  await userEvent.click(screen.getByRole('button', { name: /apply filter/i }));
}

function routeMock() {
  mockCloudFetch.mockImplementation((url: string) => {
    if (isListUrl(url)) return Promise.resolve({ traces: [{ traceId: 'tr_1', name: 'checkout' }] });
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

    // M59 P1 — Compare lives in the bulk-action bar, which appears only when ≥1 row is selected.
    expect(screen.queryByRole('button', { name: /compare/i })).toBeNull(); // 0 selected → no bulk bar

    await userEvent.click(screen.getByLabelText('Select tr_1 for compare'));
    expect(screen.getByRole('button', { name: /compare/i })).toBeDisabled(); // 1 selected — present, disabled

    await userEvent.click(screen.getByLabelText('Select tr_2 for compare'));
    const compare2 = screen.getByRole('button', { name: /compare/i });
    expect(compare2).toBeEnabled(); // exactly 2 → enabled
    expect(compare2).toHaveAttribute('data-compare-href', '/observability/compare?ids=tr_1,tr_2');

    await userEvent.click(screen.getByLabelText('Select tr_3 for compare'));
    expect(screen.getByRole('button', { name: /compare/i })).toBeDisabled(); // 3 → disabled (pairwise)
  });

  it('M64 — Create regression dataset from selected traces (create dataset + add each)', async () => {
    filterMock([{ traceId: 'tr_1', name: 'a' }, { traceId: 'tr_2', name: 'b' }]);
    // the dataset create + add-item writes resolve; the list GET returns the traces.
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (typeof url === 'string' && url.includes('/datasets') && init?.method === 'POST') {
        return Promise.resolve(url.endsWith('/datasets') ? { id: 'ds-new' } : { id: 'ds-new', items: [] });
      }
      return Promise.resolve({ traces: [{ traceId: 'tr_1', name: 'a' }, { traceId: 'tr_2', name: 'b' }] });
    });
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(screen.getByLabelText('Select tr_1 for compare'));
    await userEvent.click(screen.getByLabelText('Select tr_2 for compare'));
    await userEvent.click(screen.getByRole('button', { name: /create regression dataset/i }));
    // one dataset create + one add-item per selected trace
    const posts = mockCloudFetch.mock.calls.filter((c) => (c[1] as { method?: string })?.method === 'POST');
    expect(posts.some((c) => c[0] === '/v1/dashboard/lens/datasets')).toBe(true);
    expect(posts.filter((c) => String(c[0]).includes('/datasets/ds-new/items'))).toHaveLength(2);
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
      // M81: the list read carries the page window (limit=50); the export pages at limit=500 — discriminate
      // on that so the list loads while the export fetch fails.
      if (isListUrl(url) && url.includes('limit=500')) return Promise.reject(new Error('export 5xx'));
      if (isListUrl(url)) return Promise.resolve({ traces: [{ traceId: 'tr_1', name: 'checkout' }] });
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
      // B-244/B-235 — o contrato de erro. Sem ele a etiqueta recusada limpava o campo e sumia.
      { throwOnError: true },
    );
  });

  it('M76 (Q-2) — a ?trace= deep-link opens the trace peek on load (URL-addressable)', async () => {
    routeMock();
    renderWithParams(<LensTracesPage />, '?trace=tr_1');
    // the peek Sheet opens from the URL param alone — no row click needed (so the labeling-queue link lands).
    expect(await screen.findByText('Trace detail')).toBeInTheDocument();
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
      // Idem: a remoção recusada fechava o diálogo e a etiqueta voltava.
      { throwOnError: true },
    );
  });

  it('opening a trace shows the span tree AND keeps the tags/annotations forms (M47, no regression)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (isListUrl(url)) return Promise.resolve({ traces: [{ traceId: 'tr_1', name: 'checkout' }] });
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
      { q: '', status: 'all', model: '', range: 'all', costMin: '', costMax: '', tokensMin: '', tokensMax: '', session: '', spanQuery: '', ...o },
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

  it('forwards the advanced filters as looptrace snake_case params (M52)', () => {
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
        spanQuery: '',
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
    // B-197 — este caso usava o `render` compartilhado, que instala o `NuqsAdapter` de PRODUÇÃO:
    // ele guarda o estado de URL num cache de MÓDULO, então um caso vizinho que digita na busca
    // deixava `?q=canary` para cá. Em ordem fixa aqueles vinham depois; sob shuffle, o caso que
    // afirma "a carga inicial NÃO envia filtro" recebia o filtro do vizinho.
    //
    // `renderWithParams(..., '')` usa o `NuqsTestingAdapter`, que mantém o estado por RENDER, e
    // declara EXPLICITAMENTE que a URL começa sem parâmetro — que é justamente a premissa deste
    // caso, e estava implícita.
    filterMock([{ traceId: 'tr_1', name: 'checkout' }]);
    renderWithParams(<LensTracesPage />, '');
    await screen.findByText('tr_1');
    // the very first list read carries only the M81 page window (limit/offset) — no FILTER params leak in
    expect(listUrls()[0]).toMatch(/^\/v1\/dashboard\/lens\/traces\?limit=\d+&offset=0$/);
    expect(listUrls().every((u) => !u.includes('q=') && !u.includes('status='))).toBe(true);
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
    await addChip(/status is/i); // enum column — Select defaults to the only option "error".
    await waitFor(() => expect(listUrls().some((u) => /[?&]status=error(&|$)/.test(u))).toBe(true));
  });

  it('selecting a model narrows the list with model=', async () => {
    filterMock([{ traceId: 'tr_1', name: 'checkout', model: 'claude-opus-4-8' }]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await addChip(/model is/i, { value: 'claude-opus-4-8', valueLabel: /model value/i });
    await waitFor(() => expect(listUrls().some((u) => u.includes('model=claude-opus-4-8'))).toBe(true));
  });

  it('selecting a time range narrows the list with from=', async () => {
    filterMock([{ traceId: 'tr_1', name: 'checkout' }]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await addChip(/time within/i); // enum column — Select defaults to "1h" → buildTraceQuery emits from=.
    await waitFor(() => expect(listUrls().some((u) => u.includes('from='))).toBe(true));
  });

  it('M92 — an attribute filter builds attr:key=value and narrows the list via span_query', async () => {
    filterMock([{ traceId: 'tr_1', name: 'checkout' }]);
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    // pick the attribute column → the composite key/value editor
    await userEvent.click(screen.getByRole('combobox', { name: /add filter/i }));
    await userEvent.click(await screen.findByRole('option', { name: /attribute is/i }));
    // an <input list=…> exposes role combobox (native autocomplete); the value input is a textbox.
    await userEvent.type(screen.getByRole('combobox', { name: /attribute key/i }), 'tier');
    await userEvent.type(screen.getByRole('textbox', { name: /attribute value/i }), 'gold');
    await userEvent.click(screen.getByRole('button', { name: /apply filter/i }));
    // the fetch carries the DSL clause, URL-encoded (attr:tier=gold → attr%3Atier%3Dgold)
    await waitFor(() =>
      expect(listUrls().some((u) => u.includes(`span_query=${encodeURIComponent('attr:tier=gold')}`))).toBe(true),
    );
    // the chip shows the human-facing key=value (no attr: prefix)
    expect(screen.getByText('tier=gold')).toBeInTheDocument();
  });

  it('M92 — facet discovery populates the attribute key datalist suggestions', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url.includes('/metrics/span-attributes'))
        return Promise.resolve({ mode: 'keys', keys: [{ key: 'gen_ai.request.temperature', count: 5 }, { key: 'tier', count: 2 }] });
      if (isListUrl(url)) return Promise.resolve({ traces: [{ traceId: 'tr_1', name: 'checkout' }] });
      return Promise.resolve({});
    });
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(screen.getByRole('combobox', { name: /add filter/i }));
    await userEvent.click(await screen.findByRole('option', { name: /attribute is/i }));
    // the discovered keys are offered as <datalist> <option>s (native autocomplete)
    await waitFor(() => {
      const opts = document.querySelectorAll('#attr-key-suggestions option');
      expect(Array.from(opts).map((o) => o.getAttribute('value'))).toEqual(['gen_ai.request.temperature', 'tier']);
    });
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

  it('M69 — the no-data empty state is instructive (carries an Instrument-an-agent action)', async () => {
    filterMock([]); // zero rows AND no active filter → the "no data yet" variant
    renderWithParams(<LensTracesPage />, '');
    expect(await screen.findByText(/no traces yet/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /instrument an agent/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/observability/quickstart'));
  });
});

// M52 — advanced filters + saved views. A mock handling the traces list + the saved-views CRUD.
function m52Mock(opts: { traces?: unknown[]; views?: Array<{ id: string; name: string; query_string: string }> } = {}) {
  const SV = '/v1/dashboard/lens/saved-views';
  mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (isListUrl(url)) return Promise.resolve({ traces: opts.traces ?? [{ traceId: 'tr_1', name: 'checkout' }] });
    if (isPath(url, SV) && (!init || init.method === undefined || init.method === 'GET'))
      return Promise.resolve({ saved_views: opts.views ?? [] });
    if (isPath(url, SV) && init?.method === 'POST') return Promise.resolve({ id: 'lsv-new', name: 'x', query_string: '?status=error' });
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
    await addChip(/cost >=/i, { value: '0.1', valueLabel: /cost value/i });
    await waitFor(() => expect(listUrls().some((u) => u.includes('min_cost_usd=0.1'))).toBe(true));
  });

  it('a session advanced filter narrows the list server-side (session_id=)', async () => {
    m52Mock({});
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await addChip(/session is/i, { value: 'sess-x', valueLabel: /session value/i });
    await waitFor(() => expect(listUrls().some((u) => u.includes('session_id=sess-x'))).toBe(true));
  });

  it('lists saved views and applies one (pushes its query string → server re-fetches)', async () => {
    // B-240 — this case passed in file order and failed alone, because what made it pass was a
    // PRECEDING case having written to `window.location` through a nuqs setter. It exercises
    // the react-router-writes / nuqs-reads path, which needs the history bridge; MemoryRouter
    // switches that off. See the case above for the full mechanism.
    window.history.replaceState({}, '', '/observability/traces');
    m52Mock({ views: [{ id: 'lsv-1', name: 'errored opus', query_string: '?status=error&model=claude-opus-4-8' }] });
    render(<LensTracesPage />, { historyRouter: true });
    await screen.findByText('tr_1');
    await userEvent.click(await screen.findByRole('button', { name: /apply view errored opus/i }));
    await waitFor(() => expect(listUrls().some((u) => u.includes('status=error') && u.includes('model=claude-opus-4-8'))).toBe(true));
  });

  it('applying a saved view re-runs the search — with no prior filter interaction', async () => {
    // B-240 — the case below ("lists saved views and applies one") passed in file order, failed
    // ALONE, and failed under shuffle. The cause is the HARNESS, and the production path is
    // sound: measured under BrowserRouter, applying a view as the first action DOES re-fetch.
    //
    // nuqs's react-router adapter reads `window.location.search` — the global one — at mount
    // (`nuqs/dist/react-router-*.js`: `useState(() => new URLSearchParams(location.search))`),
    // and afterwards updates only on `popstate` or on nuqs's own emitter. In a browser,
    // react-router's `setSearchParams` calls `history.pushState`, which nuqs PATCHES to emit —
    // that is the bridge. MemoryRouter never touches `window.history`, so under it the bridge
    // cannot fire, and what made this case pass was a PRECEDING case having written to
    // `window.location` through a nuqs setter.
    //
    // Seeding `window.location` is what the browser does before the page mounts, so it is the
    // honest fix. The item recorded two other exits and measured both wrong: `initialEntries`
    // (nuqs does not read it) and `NuqsTestingAdapter` (does not propagate the push this case
    // exercises). This is the third, and it needs no change to the page.
    window.history.replaceState({}, '', '/observability/traces?session=sess-old');

    m52Mock({ views: [{ id: 'lsv-1', name: 'errored opus', query_string: '?status=error&model=claude-opus-4-8' }] });
    render(<LensTracesPage />, { historyRouter: true });
    await screen.findByText('tr_1');

    // The premise, asserted rather than assumed: the page really IS filtered before the click.
    // Without it the "session is gone" check below is vacuously true — the trap this item's own
    // block records, and the one a review caught me falling into.
    await waitFor(() => expect(listUrls().some((u) => u.includes('session_id=sess-old'))).toBe(true));

    await userEvent.click(await screen.findByRole('button', { name: /apply view errored opus/i }));

    await waitFor(() =>
      expect(listUrls().some((u) => u.includes('status=error') && u.includes('model=claude-opus-4-8'))).toBe(true),
    );
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

describe('LensTracesPage — M61 Ask copilot affordance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a per-row "Ask copilot" affordance that docks the copilot to that trace', async () => {
    m52Mock({ traces: [{ traceId: 'tr_1', name: 'checkout' }] });
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    // the affordance carries the trace context (→ /observability/ask?traceId=tr_1) — no manual UUID entry.
    expect(screen.getByRole('button', { name: /ask copilot about tr_1/i })).toBeInTheDocument();
  });
});

describe('LensTracesPage — M59 P3 columns + naming Dialog + viewId + per-tenant isolation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the Columns toggle hides a spine column (captured by the saved-view URL)', async () => {
    m52Mock({ traces: [{ traceId: 'tr_1', name: 'a', durationMs: 100, totalTokens: 50, costUsd: 0.01 }] });
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    expect(screen.getByText('Duration')).toBeInTheDocument(); // the column header (M53/#74: renamed from "Latency")
    await userEvent.click(screen.getByRole('button', { name: /choose columns/i }));
    // the toggle aria-label uses the stable column KEY ('latency'), unchanged so saved views survive
    await userEvent.click(await screen.findByRole('checkbox', { name: /toggle latency column/i }));
    expect(screen.queryByText('Duration')).toBeNull(); // hidden
  });

  it('Save current view opens a naming Dialog and POSTs the view', async () => {
    m52Mock({});
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(screen.getByRole('button', { name: /save current view/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/save current view/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/saved view name/i), 'my view');
    await userEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(svCalls('POST').length).toBeGreaterThan(0));
  });

  it('applying a saved view marks it active + shareable (viewId in the URL)', async () => {
    m52Mock({ views: [{ id: 'lsv-1', name: 'errored', query_string: '?status=error' }] });
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await userEvent.click(await screen.findByRole('button', { name: /apply view errored/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /apply view errored/i })).toHaveAttribute('aria-current', 'true'),
    );
  });

  it('renders only this workspace’s saved views (per-tenant — never another tenant’s)', async () => {
    m52Mock({ views: [{ id: 'lsv-a', name: 'tenant-a-view', query_string: '?status=error' }] });
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    expect(screen.getByRole('button', { name: /apply view tenant-a-view/i })).toBeInTheDocument();
    // a different tenant's view is never in this Principal-scoped list.
    expect(screen.queryByRole('button', { name: /apply view tenant-b-view/i })).toBeNull();
  });

  it('a ?viewId= not in this workspace applies nothing (client-side isolation negative case)', async () => {
    m52Mock({ views: [{ id: 'lsv-1', name: 'mine', query_string: '?status=error' }] });
    render(<LensTracesPage />, { initialEntries: ['/observability/traces?viewId=lsv-other'] });
    await screen.findByText('tr_1');
    // the phantom viewId resolves against THIS workspace's list only → no view is applied, no crash.
    expect(screen.getByRole('button', { name: /apply view mine/i })).not.toHaveAttribute('aria-current', 'true');
  });
});

describe('LensTracesPage — M59 P1 density toggle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the density toggle flips the table wrapper density (default comfortable → compact)', async () => {
    m52Mock({});
    const { container } = render(<LensTracesPage />);
    await screen.findByText('tr_1');
    expect(container.querySelector('[data-density="comfortable"]')).toBeTruthy();
    expect(container.querySelector('[data-density="compact"]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /toggle row density/i }));
    expect(container.querySelector('[data-density="compact"]')).toBeTruthy();
  });
});

describe('LensTracesPage — M59 P2 chip filters', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adding a filter renders a removable chip + a count badge, and narrows the list (status=error)', async () => {
    m52Mock({});
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await addChip(/status is/i);
    // the status chip is present (targeted by its unique remove control) with a count badge.
    const removeStatus = await screen.findByRole('button', { name: /remove status filter/i });
    expect(removeStatus.closest('[data-testid="filter-chip"]')?.textContent).toMatch(/status is error/i);
    expect(screen.getByTestId('filter-count')).toBeInTheDocument();
    await waitFor(() => expect(listUrls().some((u) => /[?&]status=error(&|$)/.test(u))).toBe(true));
  });

  it("a chip's × removes it and drops the param from the URL (round-trip to baseline)", async () => {
    m52Mock({});
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    await addChip(/cost >=/i, { value: '0.1', valueLabel: /cost value/i });
    await waitFor(() => expect(listUrls().some((u) => u.includes('min_cost_usd=0.1'))).toBe(true));
    await userEvent.click(await screen.findByRole('button', { name: /remove cost filter/i }));
    // the cost chip is gone (its unique remove control no longer exists)…
    expect(screen.queryByRole('button', { name: /remove cost filter/i })).toBeNull();
    // …and the newest list fetch no longer carries the cost param.
    await waitFor(() => expect(listUrls().at(-1) ?? '').not.toMatch(/min_cost_usd/));
  });
});

describe('LensTracesPage — M59 P1 Sheet peek + bulk-action bar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clicking a trace row opens the peek Sheet (a dialog, not an inline card)', async () => {
    m52Mock({ traces: [{ traceId: 'tr_1', name: 'checkout' }] });
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    // no peek before the click.
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /open tr_1/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Trace detail')).toBeInTheDocument();
  });

  it('the bulk-action bar appears only when ≥1 row is selected', async () => {
    m52Mock({ traces: [{ traceId: 'tr_1', name: 'a' }, { traceId: 'tr_2', name: 'b' }] });
    render(<LensTracesPage />);
    await screen.findByText('tr_1');
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull(); // 0 selected → hidden
    await userEvent.click(screen.getByLabelText('Select tr_1 for compare'));
    const bar = await screen.findByTestId('bulk-action-bar');
    expect(within(bar).getByText(/1 selected/i)).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /compare/i })).toBeInTheDocument();
    // clearing selection hides the bar again.
    await userEvent.click(within(bar).getByRole('button', { name: /clear selection/i }));
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull();
  });

  it('M81 — a server-side pager reaches page 2 (limit/offset) and discloses the total', async () => {
    // total 120 > pageSize 50 → the pager shows; page 1 sends offset=0, Next sends offset=50.
    mockCloudFetch.mockImplementation((url: string) => {
      if (isListUrl(url)) {
        const offset = new URL(url, 'http://x').searchParams.get('offset') ?? '0';
        return Promise.resolve({ traces: [{ traceId: `tr-${offset}`, name: 'row' }], total: 120, limit: 50, offset: Number(offset) });
      }
      if (url.includes('/tags')) return Promise.resolve({ tags: [] });
      return Promise.resolve({});
    });
    render(<LensTracesPage />);
    expect(await screen.findByText(/of 120/i)).toBeInTheDocument(); // total disclosed
    expect(mockCloudFetch.mock.calls.some((c) => String(c[0]).includes('offset=0'))).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText('tr-50')).toBeInTheDocument(); // page 2 fetched (offset=50)
    expect(mockCloudFetch.mock.calls.some((c) => String(c[0]).includes('offset=50'))).toBe(true);
  });
});
