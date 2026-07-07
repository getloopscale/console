import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';

import { render, screen, within } from '@/test/render';
import { LensExperimentsPage } from './experiments';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
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
      const r = (opts.runPost ?? (() => RUN))();
      return Promise.resolve(r);
    }
    if (url.includes('/experiment-runs')) {
      if (url.includes('/compare')) return Promise.resolve({ runs: [RUN, { ...RUN, id: 'run-2', name: 'run B', passCount: 2, items: RUN.items.map((it) => ({ ...it, scores: [{ name: 'acc', score: 1, label: 'pass' }] })) }] });
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

  it('test_run_lists_existing_runs', async () => {
    withRoutes();
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments'] });
    expect(await screen.findByText('run A')).toBeInTheDocument();
  });

  it('test_compare_two_runs_shows_score_deltas', async () => {
    withRoutes();
    render(<LensExperimentsPage />, { initialEntries: ['/observability/experiments?compare=run-1,run-2'] });
    // two run columns + a per-run aggregate; the pass-count delta is shown
    expect(await screen.findByText('run A')).toBeInTheDocument();
    expect(screen.getByText('run B')).toBeInTheDocument();
    expect(screen.getByTestId('passrate-delta')).toBeInTheDocument();
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
});
