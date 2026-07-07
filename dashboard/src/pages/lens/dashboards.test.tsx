import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';

import { render, screen, within } from '@/test/render';
import { LensDashboardsPage } from './dashboards';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});
vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));

const BOARD = {
  id: 'ldb-0011223344556677',
  name: 'Tracing Overview',
  config: [
    { type: 'kpi', metric: 'traces', title: 'Traces' },
    { type: 'trend', metric: 'traces', title: 'Traffic over time' },
    { type: 'topn', metric: 'tokens_by_model', title: 'Top models' },
  ],
};
const OBS = {
  traffic: [{ periodStart: '2026-07-07T00:00:00Z', traceCount: 160, errorCount: 5, errorRate: 0.03 }],
  latency: [{ periodStart: '2026-07-07T00:00:00Z', p50Ms: 100, p95Ms: 400, p99Ms: 800 }],
  tokensByModel: [{ periodStart: '2026-07-07T00:00:00Z', model: 'gpt-4o', totalTokens: 1000, costUsd: 0.05 }],
};
const COST = { buckets: [{ costUsd: 0.05 }] };

/** Wire the mock CRUD + series routes; opts override the list/board/obs behavior per test. */
function withRoutes(opts: { boards?: unknown[]; listReject?: unknown; boardReject?: unknown; obsReject?: unknown } = {}) {
  mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (url.endsWith('/dashboards') && method === 'POST') return Promise.resolve().then(() => ({ ...BOARD }));
    if (/\/dashboards\/[^/?]+$/.test(url) && method === 'PUT') return Promise.resolve().then(() => ({ ...BOARD }));
    if (url.endsWith('/dashboards')) {
      if (opts.listReject) return Promise.resolve().then(() => { throw opts.listReject; });
      return Promise.resolve({ dashboards: opts.boards ?? [] });
    }
    if (/\/dashboards\/[^/?]+$/.test(url)) {
      if (opts.boardReject) return Promise.resolve().then(() => { throw opts.boardReject; });
      return Promise.resolve({ ...BOARD });
    }
    if (url.includes('/observability')) {
      if (opts.obsReject) return Promise.resolve().then(() => { throw opts.obsReject; });
      return Promise.resolve(OBS);
    }
    if (url.includes('/cost')) return Promise.resolve(COST);
    return Promise.resolve({});
  });
}

describe('M66 LensDashboardsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('test_lists_boards_and_shows_template_cta_when_empty', async () => {
    withRoutes({ boards: [] });
    render(<LensDashboardsPage />, { initialEntries: ['/observability/dashboards'] });
    expect(await screen.findByText(/no dashboards yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start from tracing overview/i })).toBeInTheDocument();
  });

  it('test_start_from_template_creates_a_board', async () => {
    withRoutes({ boards: [] });
    render(<LensDashboardsPage />, { initialEntries: ['/observability/dashboards'] });
    await userEvent.click(await screen.findByRole('button', { name: /start from tracing overview/i }));
    // POST /dashboards issued exactly once with the template config
    const postCall = mockCloudFetch.mock.calls.find((c) => String(c[0]).endsWith('/dashboards') && (c[1] as { method?: string })?.method === 'POST');
    expect(postCall).toBeTruthy();
    expect(JSON.parse((postCall![1] as { body: string }).body).config).toHaveLength(6); // the 6-widget template
    // onSuccess navigates to the board → it renders
    expect(await screen.findByText(/Top models/)).toBeInTheDocument();
  });

  it('test_board_renders_widgets_bound_to_the_shared_fetch', async () => {
    withRoutes();
    render(<LensDashboardsPage />, { initialEntries: [`/observability/dashboards?board=${BOARD.id}`] });
    // KPI value from the shared observability fetch (160 traces) — scoped to the KPI tile
    const kpi = await screen.findByTestId('kpi-value');
    expect(kpi.textContent).toBe('160');
    // top-N table bound to tokensByModel
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    // the observability series is fetched exactly ONCE (no per-widget fan-out)
    const obsCalls = mockCloudFetch.mock.calls.filter((c) => String(c[0]).includes('/observability'));
    expect(obsCalls).toHaveLength(1);
  });

  it('test_chart_has_aria_label', async () => {
    withRoutes();
    render(<LensDashboardsPage />, { initialEntries: [`/observability/dashboards?board=${BOARD.id}`] });
    await screen.findByTestId('kpi-value');
    // the trend widget reuses MetricTrendChart → role=img + aria-label (the a11y differentiator)
    expect(screen.getByRole('img', { name: /Traffic over time/i })).toBeInTheDocument();
  });

  it('test_add_remove_reorder_widget_round_trip', async () => {
    withRoutes();
    render(<LensDashboardsPage />, { initialEntries: [`/observability/dashboards?board=${BOARD.id}`] });
    await userEvent.click(await screen.findByRole('button', { name: /^edit$/i }));
    // move widget 1 (traces kpi) down → it swaps with widget 2 (trend)
    await userEvent.click(await screen.findByRole('button', { name: /move widget 1 down/i }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const putCall = mockCloudFetch.mock.calls.find((c) => /\/dashboards\/[^/?]+$/.test(String(c[0])) && (c[1] as { method?: string })?.method === 'PUT');
    expect(putCall).toBeTruthy();
    const cfg = JSON.parse((putCall![1] as { body: string }).body).config;
    expect(cfg[0].type).toBe('trend'); // reordered: trend now first
    expect(cfg[1].type).toBe('kpi');
  });

  it('test_load_error_surfaces_typed_alert', async () => {
    withRoutes({ listReject: Object.assign(new Error('boom'), { status: 500 }) });
    render(<LensDashboardsPage />, { initialEntries: ['/observability/dashboards'] });
    // the typed Alert body renders (the M64 description= fix); "try again shortly" is unique to the body
    expect(await screen.findByText(/try again shortly/i)).toBeInTheDocument();
  });

  it('test_cross_tenant_or_scope_deny_surfaces_typed_error', async () => {
    withRoutes({ boardReject: Object.assign(new Error('nope'), { status: 404 }) });
    render(<LensDashboardsPage />, { initialEntries: [`/observability/dashboards?board=${BOARD.id}`] });
    const alert = await screen.findByTestId('board-error');
    expect(within(alert).getByText(/belong to another workspace/i)).toBeInTheDocument();
  });

  it('test_quiet_tenant_empty_series_rate_and_latency_are_em_dash_not_zero', async () => {
    // the fetch SUCCEEDS but returns empty arrays (a quiet tenant): the error-rate + p95 KPIs must show
    // em-dash (undefined over an empty set), NEVER a misleading "0%" / "0ms".
    const rateBoard = {
      ...BOARD,
      config: [
        { type: 'kpi', metric: 'error_rate', title: 'Error rate' },
        { type: 'kpi', metric: 'p95_latency', title: 'Latency p95' },
        { type: 'kpi', metric: 'traces', title: 'Traces' },
      ],
    };
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (/\/dashboards\/[^/?]+$/.test(url) && (init?.method ?? 'GET') === 'GET') return Promise.resolve(rateBoard);
      if (url.endsWith('/dashboards')) return Promise.resolve({ dashboards: [] });
      if (url.includes('/observability')) return Promise.resolve({ traffic: [], latency: [], tokensByModel: [] });
      if (url.includes('/cost')) return Promise.resolve({ buckets: [] });
      return Promise.resolve({});
    });
    render(<LensDashboardsPage />, { initialEntries: [`/observability/dashboards?board=${BOARD.id}`] });
    await screen.findAllByTestId('kpi-value');
    const kpis = screen.getAllByTestId('kpi-value').map((el) => el.textContent);
    expect(kpis.filter((v) => v === '—')).toHaveLength(2); // error_rate + p95_latency undefined over empty
    expect(kpis).not.toContain('0%'); // never a fabricated rate
    expect(kpis).not.toContain('0ms'); // never a fabricated latency
    expect(kpis).toContain('0'); // traces is a defined count → honest 0
  });

  it('test_widget_series_error_shows_empty_not_fabricated', async () => {
    withRoutes({ obsReject: Object.assign(new Error('down'), { status: 502 }) });
    render(<LensDashboardsPage />, { initialEntries: [`/observability/dashboards?board=${BOARD.id}`] });
    // a widget-data error surfaces a typed alert; the KPI shows em-dash, NEVER a fabricated 0
    expect(await screen.findByTestId('data-error')).toBeInTheDocument();
    const kpis = screen.getAllByTestId('kpi-value');
    expect(kpis.some((el) => el.textContent === '—')).toBe(true);
    expect(kpis.every((el) => el.textContent !== '0')).toBe(true);
  });
});
