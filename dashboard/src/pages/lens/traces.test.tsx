import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { within, waitFor, render as rtlRender, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
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
            <NuqsTestingAdapter searchParams={searchParams}>
              <PageMetaProvider>{children}</PageMetaProvider>
            </NuqsTestingAdapter>
          </Toaster>
        </ThemeProvider>
      </QueryClientProvider>
    ),
  });
}

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

// Mock the M48 trace-detail's layout lib (jsdom cannot lay it out — see trace-detail.test.tsx).
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: (props: Record<string, unknown>) => <div role="separator" {...props} />,
}));

import { LensTracesPage, buildTraceQuery } from './traces';

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

describe('buildTraceQuery (M49 — pure filter→querystring mapping)', () => {
  const NOW = Date.UTC(2026, 6, 4, 12, 0, 0); // fixed clock, injected — deterministic

  it('emits an empty string when no filter is active', () => {
    expect(buildTraceQuery({ q: '', status: 'all', model: '', range: 'all' }, NOW)).toBe('');
  });

  it('trims and forwards a non-empty search term as q=', () => {
    expect(buildTraceQuery({ q: '  boom  ', status: 'all', model: '', range: 'all' }, NOW)).toBe('?q=boom');
  });

  it('forwards status only when it is error (all is the sentinel for "no filter")', () => {
    expect(buildTraceQuery({ q: '', status: 'error', model: '', range: 'all' }, NOW)).toBe('?status=error');
  });

  it('forwards a selected model and omits an empty one', () => {
    expect(buildTraceQuery({ q: '', status: 'all', model: 'claude-opus-4-8', range: 'all' }, NOW)).toContain(
      'model=claude-opus-4-8',
    );
    expect(buildTraceQuery({ q: '', status: 'all', model: '', range: 'all' }, NOW)).not.toContain('model=');
  });

  it('maps a time range to a from= ISO timestamp computed from the injected clock', () => {
    const qs = buildTraceQuery({ q: '', status: 'all', model: '', range: '1h' }, NOW);
    const from = new URLSearchParams(qs.slice(1)).get('from');
    expect(from).toBe(new Date(NOW - 3_600_000).toISOString());
  });

  it('omits from= when the range is "all"', () => {
    expect(buildTraceQuery({ q: '', status: 'all', model: '', range: 'all' }, NOW)).not.toContain('from=');
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
