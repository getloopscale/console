import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';

import { render, screen, within } from '@/test/render';
import { LensExperimentsPage } from './experiments';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http/api')>();
  return { ...actual, cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});
vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));

const RUN = {
  id: 'run-1',
  datasetId: 'ds-1',
  name: 'run A',
  variant: { model: 'gpt-x' },
  status: 'completed',
  truncated: false,
  itemCount: 2,
  passCount: 1,
  avgScore: 0.5,
  totalCostUsd: 0.006,
  createdBy: 'u',
  createdAt: '2026-07-07T00:00:00Z',
  items: [
    { datasetItemTraceId: 't1', output: 'good answer', promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.003, latencyMs: 100, model: 'gpt-x', scores: [{ name: 'acc', score: 1, label: 'pass' }] },
    { datasetItemTraceId: 't2', output: 'bad answer', promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.003, latencyMs: 120, model: 'gpt-x', scores: [{ name: 'acc', score: 0, label: 'fail' }] },
  ],
};

function withRoutes(opts: { runPost?: () => unknown; trace?: unknown } = {}) {
  mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
    const isPost = init?.method === 'POST';
    if (url.endsWith('/experiment-runs') && isPost) {
      // mirror the async cloudFetch: a throwing runPost becomes a REJECTED promise (preserves the error's .status)
      return Promise.resolve().then(() => (opts.runPost ?? (() => RUN))());
    }
    if (url.includes('/experiment-runs')) {
      if (url.includes('/compare'))
        return Promise.resolve({
          runs: [RUN, { ...RUN, id: 'run-2', name: 'run B', passCount: 2, items: RUN.items.map((it) => ({ ...it, scores: [{ name: 'acc', score: 1, label: 'pass' }] })) }],
          deltas: { passCountDelta: -1, passRateDelta: -0.5, avgScoreDelta: -0.25, totalCostDelta: 0, avgLatencyDelta: 0 },
        });
      if (/\/experiment-runs\/[^/?]+$/.test(url)) return Promise.resolve(RUN);
      return Promise.resolve({ runs: [RUN] });
    }
    if (/\/traces\/[^/]+$/.test(url)) return Promise.resolve(opts.trace ?? { spanId: 's', traceId: 't1', name: 'root', children: [] });
    return Promise.resolve({});
  });
}

describe('M64 LensExperimentsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('test_run_experiment_shows_per_row_output_and_scores', async () => {
    withRoutes();
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments?datasetId=ds-1'] });
    await userEvent.click(await screen.findByRole('button', { name: /run experiment/i }));
    // the run rows render with output + score
    expect(await screen.findByText('good answer')).toBeInTheDocument();
    // aggregate pass-rate (scoped to the latest-run block — the recent-runs list also renders a summary)
    const latest = screen.getByTestId('latest-run');
    expect(within(latest).getByText(/1\s*\/\s*2 passed/i)).toBeInTheDocument();
    const runCall = mockCloudFetch.mock.calls.find((c) => String(c[0]).endsWith('/experiment-runs') && (c[1] as { method?: string })?.method === 'POST');
    expect(runCall).toBeTruthy();
    expect(JSON.parse((runCall![1] as { body: string }).body)).toMatchObject({ datasetId: 'ds-1' });
  });

  it('test_unscored_row_renders_em_dash_not_fabricated_zero (#177)', async () => {
    // A run whose row has an evaluator score with NEITHER a label NOR a numeric score.
    const unscored = {
      ...RUN,
      items: [{ ...RUN.items[0], scores: [{ name: 'acc' }] }],
    };
    withRoutes({ runPost: () => unscored });
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments?datasetId=ds-1'] });
    await userEvent.click(await screen.findByRole('button', { name: /run experiment/i }));
    const latest = screen.getByTestId('latest-run');
    // the un-evaluated score shows an em-dash, NEVER a fabricated "0.00"
    expect(within(latest).getByText(/acc: —/)).toBeInTheDocument();
    expect(within(latest).queryByText(/acc: 0\.00/)).not.toBeInTheDocument();
  });

  it('test_run_lists_existing_runs', async () => {
    withRoutes();
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments'] });
    expect(await screen.findByText('run A')).toBeInTheDocument();
  });

  it('M73 — the empty page has a dataset picker that seeds a run (no dead-end)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url.startsWith('/v1/dashboard/lens/datasets') && !url.includes('/items'))
        return Promise.resolve({ datasets: [{ id: 'ds-9', name: 'golden set' }] });
      if (url.includes('/experiment-runs')) return Promise.resolve({ runs: [] });
      return Promise.resolve({});
    });
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments'] });
    // the run form is a centered modal opened by the "New run" action — pick a dataset → run is enabled
    await userEvent.click(await screen.findByRole('button', { name: /new run/i }));
    await userEvent.click(await screen.findByRole('combobox', { name: /dataset/i }));
    await userEvent.click(await screen.findByRole('option', { name: /golden set/i }));
    // the run form (with the "Run experiment" submit) is reachable from the previously-dead page
    expect(await screen.findByRole('button', { name: /run experiment/i })).toBeInTheDocument();
  });

  it('M73 — the empty page with NO datasets keeps the instructive text (no fabricated picker)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url.startsWith('/v1/dashboard/lens/datasets') && !url.includes('/items'))
        return Promise.resolve({ datasets: [] });
      if (url.includes('/experiment-runs')) return Promise.resolve({ runs: [] });
      return Promise.resolve({});
    });
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments'] });
    expect(await screen.findByText(/create a regression dataset from the traces list/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /dataset/i })).not.toBeInTheDocument();
  });

  it('M70 — the runs list has a compare-picker: select two → navigate to ?compare= (drillable)', async () => {
    mockCloudFetch.mockImplementation((url: string) => {
      if (url.includes('/experiment-runs') && !url.includes('/compare'))
        return Promise.resolve({ runs: [RUN, { ...RUN, id: 'run-2', name: 'run B' }] });
      if (url.includes('/compare'))
        return Promise.resolve({ runs: [RUN, { ...RUN, id: 'run-2', name: 'run B' }], deltas: null });
      return Promise.resolve({});
    });
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments'] });
    await userEvent.click(await screen.findByRole('checkbox', { name: /select run A to compare/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /select run B to compare/i }));
    await userEvent.click(screen.getByRole('button', { name: /compare selected \(2\/2\)/i }));
    // the compare view opened (two run columns) — proves ?compare= drove the navigation
    expect(await screen.findByText(/A · run A/)).toBeInTheDocument();
    expect(screen.getByText(/B · run B/)).toBeInTheDocument();
  });

  it('test_compare_two_runs_shows_passrate_and_per_row_deltas', async () => {
    withRoutes();
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments?compare=run-1,run-2'] });
    // two run columns + a per-run aggregate; the AGGREGATE pass-rate delta (DoD3) is shown from `deltas`
    expect(await screen.findByText(/A · run A/)).toBeInTheDocument();
    expect(screen.getByText(/B · run B/)).toBeInTheDocument();
    const deltaBlock = screen.getByTestId('passrate-delta');
    expect(within(deltaBlock).getByText(/Pass-rate/i)).toBeInTheDocument();
    expect(within(deltaBlock).getByText('-0.50')).toBeInTheDocument(); // the pass-rate delta value from the API
    // per-row score delta column (B vs A) is present in the second run's table
    expect(screen.getByText('Δ vs A')).toBeInTheDocument();
  });

  it('test_view_trace_opens_source_span_detail', async () => {
    withRoutes();
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments?datasetId=ds-1'] });
    await userEvent.click(await screen.findByRole('button', { name: /run experiment/i }));
    await screen.findByText('good answer');
    await userEvent.click(screen.getAllByRole('button', { name: /view trace/i })[0]);
    expect(await screen.findByText(/trace detail/i)).toBeInTheDocument();
  });

  it('test_run_provider_error_surfaces_typed_alert (no fabricated rows)', async () => {
    withRoutes({ runPost: () => { throw new Error('503 provider'); } });
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments?datasetId=ds-1'] });
    await userEvent.click(await screen.findByRole('button', { name: /run experiment/i }));
    expect(await screen.findByTestId('run-error')).toBeInTheDocument();
    expect(screen.queryByText('good answer')).toBeNull();
  });

  it('test_run_scope_denied_surfaces_permission_alert (403, no fabricated rows)', async () => {
    // a scope/tenant deny (403 from the Principal-scoped BFF) fails closed to a typed permission message.
    withRoutes({ runPost: () => { throw Object.assign(new Error('forbidden'), { status: 403 }); } });
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments?datasetId=ds-1'] });
    await userEvent.click(await screen.findByRole('button', { name: /run experiment/i }));
    const alert = await screen.findByTestId('run-error');
    expect(within(alert).getByText(/do not have permission/i)).toBeInTheDocument();
    expect(screen.queryByText('good answer')).toBeNull();
  });
});
