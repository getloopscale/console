import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';

import { render, screen, within } from '@/test/render';
import { waitFor } from '@testing-library/react';
import type { TraceSpanNode } from '@/hooks/lens/trace-layout';
import { LensPlayground } from './playground';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http/api')>();
  return { ...actual, cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});

const span: TraceSpanNode = {
  spanId: 's1',
  traceId: 'tr-1',
  name: 'llm.call',
  model: 'claude-sonnet-4-6',
  inputTokens: 40,
  outputTokens: 12,
  inputValue: JSON.stringify([{ role: 'user', content: 'hi' }]),
  outputValue: 'original answer',
  startTimeUnixNano: '1000000000',
  endTimeUnixNano: '1005800000',
};

const REPLAY_OK = { output: 'variant out', promptTokens: 1, completionTokens: 1, totalTokens: 2, latencyMs: 10, model: 'm', costUsd: 0.0001 };

// Route the mock by URL: GET trace tree (View-Trace) vs POST replay vs datasets.
function routed(over: (url: string) => unknown = () => REPLAY_OK) {
  mockCloudFetch.mockImplementation((url: string) => {
    if (url.endsWith('/replay')) return Promise.resolve(over(url));
    if (url.includes('/datasets')) return Promise.resolve({ datasets: [] });
    // the trace-tree GET used by View-Trace's LensTraceDetail
    if (/\/traces\/[^/]+$/.test(url)) return Promise.resolve({ spanId: 's1', traceId: 'tr-1', name: 'root', children: [] });
    return Promise.resolve(null);
  });
}

const variantCols = () => screen.getAllByTestId('variant-column');
const replayPosts = () => mockCloudFetch.mock.calls.filter((c) => String(c[0]).endsWith('/replay'));

describe('M62 LensPlayground (side-by-side)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routed();
  });

  it('test_add_and_remove_variant_columns (respects the cap)', async () => {
    render(<LensPlayground span={span} />);
    expect(variantCols()).toHaveLength(1); // seeded with one variant
    const add = screen.getByRole('button', { name: /add variant/i });
    await userEvent.click(add); // 2
    await userEvent.click(add); // 3
    await userEvent.click(add); // 4 (cap)
    expect(variantCols()).toHaveLength(4);
    expect(add).toBeDisabled(); // cap reached
    // remove one column
    await userEvent.click(within(variantCols()[0]).getByRole('button', { name: /remove variant/i }));
    expect(variantCols()).toHaveLength(3);
    expect(screen.getByRole('button', { name: /add variant/i })).toBeEnabled();
  });

  it('test_run_all_fires_one_replay_per_variant', async () => {
    render(<LensPlayground span={span} />);
    await userEvent.click(screen.getByRole('button', { name: /add variant/i })); // 2 variants
    await userEvent.click(screen.getByRole('button', { name: /run all/i }));
    expect(await screen.findAllByText('variant out')).toHaveLength(2);
    expect(replayPosts()).toHaveLength(2); // exactly one replay per variant
  });

  it('test_view_trace_opens_span_detail_sheet', async () => {
    render(<LensPlayground span={span} />);
    await userEvent.click(screen.getByRole('button', { name: /view trace/i }));
    // the M58 Sheet opens and its LensTraceDetail fetches the trace tree for the original span
    expect(await screen.findByText(/trace detail/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(mockCloudFetch.mock.calls.some((c) => c[0] === '/v1/dashboard/lens/traces/tr-1')).toBe(true),
    );
    expect(screen.getByTestId('playground')).toBeInTheDocument(); // playground stays mounted underneath
  });

  it('test_original_never_mutates_across_runs (baseline read-only)', async () => {
    render(<LensPlayground span={span} />);
    await userEvent.click(screen.getByRole('button', { name: /run all/i }));
    await screen.findByText('variant out');
    // the baseline column still shows the ORIGINAL output + original model, unchanged by the variant run
    expect(within(screen.getByTestId('baseline-column')).getByTestId('baseline-output')).toHaveTextContent('original answer');
    expect(within(screen.getByTestId('baseline-column')).getByText('claude-sonnet-4-6')).toBeInTheDocument();
  });

  it('test_view_trace_404_keeps_playground_mounted', async () => {
    // the trace-tree GET (View-Trace) fails 404 (foreign/missing) — the Sheet opens with the M58 detail
    // (which owns its own error state) and the playground stays mounted underneath (never unmounts).
    mockCloudFetch.mockImplementation((url: string) => {
      if (url.endsWith('/replay')) return Promise.resolve(REPLAY_OK);
      if (/\/traces\/[^/]+$/.test(url)) return Promise.reject(new Error('404 trace not found'));
      return Promise.resolve(null);
    });
    render(<LensPlayground span={span} />);
    await userEvent.click(screen.getByRole('button', { name: /view trace/i }));
    expect(await screen.findByText(/trace detail/i)).toBeInTheDocument(); // Sheet opened
    expect(mockCloudFetch.mock.calls.some((c) => c[0] === '/v1/dashboard/lens/traces/tr-1')).toBe(true);
    expect(screen.getByTestId('playground')).toBeInTheDocument(); // playground survives the failed detail load
  });

  it('test_cross_tenant_replay_refusal_surfaces_typed_error', async () => {
    routed(() => {
      throw new Error('404 trace belongs to another workspace');
    });
    render(<LensPlayground span={span} />);
    await userEvent.click(screen.getByRole('button', { name: /run all/i }));
    expect(await screen.findByTestId('variant-error')).toBeInTheDocument();
    expect(screen.queryByTestId('variant-output')).toBeNull(); // no fabricated output
  });
});
