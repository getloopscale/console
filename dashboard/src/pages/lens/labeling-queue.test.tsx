import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import type { TraceSpanNode } from '@/hooks/lens/trace-layout';
import { LensLabelingQueuePage } from './labeling-queue';
import { SpanDetail } from './trace-detail/span-detail';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http/api')>();
  return { ...actual, cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});
vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));

const PENDING_ITEM = {
  id: 'i1',
  traceId: 'tr-1',
  spanId: 'sp-1',
  status: 'pending',
  createdBy: 'reviewer-a',
  createdAt: '2026-07-07T00:00:00Z',
};

function pageWith(list: unknown, over: (url: string, init?: { method?: string }) => unknown = () => ({})) {
  mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (url.includes('/labeling-queue') && (!init || init.method === undefined || init.method === 'GET')) {
      return Promise.resolve(list);
    }
    return Promise.resolve(over(url, init));
  });
}

/** Render the page and open the resolve Sheet for the single pending item (sp-1). */
async function renderAndOpenResolve() {
  render(<LensLabelingQueuePage />);
  await userEvent.click(await screen.findByRole('button', { name: /review sp-1/i }));
}

/** The POST body sent to the resolve route for item i1, or undefined if none. */
function resolveBodyFor(id = 'i1'): unknown {
  const call = mockCloudFetch.mock.calls.find(
    (c) => String(c[0]).includes(`/labeling-queue/${id}/resolve`) && (c[1] as { method?: string })?.method === 'POST',
  );
  return call ? JSON.parse((call[1] as { body: string }).body) : undefined;
}

describe('M63 LensLabelingQueuePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('test_queue_list_renders_pending_items', async () => {
    pageWith({ items: [PENDING_ITEM], total: 1, page: 1, pageSize: 50 });
    render(<LensLabelingQueuePage />);
    expect(await screen.findByText('sp-1')).toBeInTheDocument();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it('M70 — a pager makes page 2 reachable + discloses the result count', async () => {
    // total 3 > pageSize 2 → 2 pages; the first page is reachable and Next fetches page 2.
    mockCloudFetch.mockImplementation((url: string) => {
      const p = new URL(url, 'http://x').searchParams.get('page') ?? '1';
      if (url.includes('/labeling-queue'))
        return Promise.resolve({
          items: [{ ...PENDING_ITEM, id: `q-${p}`, spanId: `sp-${p}` }],
          total: 3,
          page: Number(p),
          pageSize: 2,
        });
      return Promise.resolve({});
    });
    render(<LensLabelingQueuePage />);
    expect(await screen.findByText(/showing 1–2 of 3/i)).toBeInTheDocument(); // count disclosed
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    // page 2 was fetched (was previously unreachable) and its distinct item renders
    expect(await screen.findByText('sp-2')).toBeInTheDocument();
    expect(mockCloudFetch.mock.calls.some((c) => String(c[0]).includes('page=2'))).toBe(true);
    expect(screen.getByTestId('queue-count').textContent).toMatch(/of 3/);
  });

  it('test_empty_state_when_no_items', async () => {
    pageWith({ items: [], total: 0, page: 1, pageSize: 50 });
    render(<LensLabelingQueuePage />);
    expect(await screen.findByText(/nothing to review/i)).toBeInTheDocument();
  });

  it('test_resolve_round_trip_writes_scoped_annotation', async () => {
    pageWith({ items: [PENDING_ITEM], total: 1, page: 1, pageSize: 50 }, (url, init) =>
      url.includes('/resolve') && init?.method === 'POST'
        ? { ...PENDING_ITEM, status: 'resolved', label: 'good' }
        : {},
    );
    await renderAndOpenResolve();
    // the resolve Sheet composes @getloopscale/ui AnnotationInputs (M12); the free-text "Label"
    // score-config renders a required label (trailing * marker), so match loosely.
    await userEvent.type(await screen.findByLabelText(/^Label/), 'good');
    await userEvent.click(screen.getByRole('button', { name: /^resolve$/i }));
    expect(resolveBodyFor()).toMatchObject({ label: 'good' });
  });

  it('M12 — selecting the categorical Quality bucket maps its score into the resolve body', async () => {
    pageWith({ items: [PENDING_ITEM], total: 1, page: 1, pageSize: 50 }, (url, init) =>
      url.includes('/resolve') && init?.method === 'POST' ? { ...PENDING_ITEM, status: 'resolved', label: 'good', score: 1 } : {},
    );
    await renderAndOpenResolve();
    await userEvent.type(await screen.findByLabelText(/^Label/), 'good');
    // the config-driven "Quality" AnnotationInput renders a RadioGroup; picking "good" → score 1
    await userEvent.click(screen.getByRole('radio', { name: 'good' }));
    await userEvent.click(screen.getByRole('button', { name: /^resolve$/i }));
    expect(resolveBodyFor()).toEqual({ label: 'good', score: 1 });
  });

  it('M76 (Q-3) — export is guarded until at least one item is resolved', async () => {
    pageWith({ items: [PENDING_ITEM], total: 1, page: 1, pageSize: 50 }); // all pending
    render(<LensLabelingQueuePage />);
    await userEvent.click(await screen.findByRole('button', { name: /export as dataset/i }));
    await userEvent.type(await screen.findByLabelText(/dataset name/i), 'golden-jul');
    // the guard warns and the Export confirm is disabled → no POST possible
    expect(screen.getByTestId('export-empty-guard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^export$/i })).toBeDisabled();
    expect(
      mockCloudFetch.mock.calls.some((c) => String(c[0]).includes('/export-as-dataset') && (c[1] as { method?: string })?.method === 'POST'),
    ).toBe(false);
  });

  it('M76 (Q-2) — the queue trace id links to its source trace', async () => {
    pageWith({ items: [PENDING_ITEM], total: 1, page: 1, pageSize: 50 });
    render(<LensLabelingQueuePage />);
    const link = await screen.findByRole('link', { name: /open trace tr-1/i });
    expect(link).toHaveAttribute('href', '/observability/traces?trace=tr-1');
  });

  it('test_export_as_dataset_posts_and_confirms', async () => {
    pageWith({ items: [{ ...PENDING_ITEM, status: 'resolved', label: 'good' }], total: 1, page: 1, pageSize: 50 }, (url, init) =>
      url.includes('/export-as-dataset') && init?.method === 'POST' ? { id: 'd1', name: 'golden', itemCount: 1 } : {},
    );
    render(<LensLabelingQueuePage />);
    await userEvent.click(await screen.findByRole('button', { name: /export as dataset/i }));
    await userEvent.type(await screen.findByLabelText(/dataset name/i), 'golden-jul');
    await userEvent.click(screen.getByRole('button', { name: /^export$/i }));
    const exportCall = mockCloudFetch.mock.calls.find(
      (c) => String(c[0]).includes('/export-as-dataset') && (c[1] as { method?: string })?.method === 'POST',
    );
    expect(exportCall).toBeTruthy();
    expect(JSON.parse((exportCall![1] as { body: string }).body)).toMatchObject({ name: 'golden-jul' });
  });

  it('test_scope_deny_or_cross_tenant_surfaces_typed_error (no fabricated success)', async () => {
    pageWith({ items: [PENDING_ITEM], total: 1, page: 1, pageSize: 50 }, (url, init) => {
      if (url.includes('/resolve') && init?.method === 'POST') throw new Error('403 insufficient scope');
      return {};
    });
    await renderAndOpenResolve();
    await userEvent.type(await screen.findByLabelText(/^Label/), 'good'); // required "Label" AnnotationInput (M12)
    await userEvent.click(screen.getByRole('button', { name: /^resolve$/i }));
    expect(await screen.findByTestId('resolve-error')).toBeInTheDocument();
    // #175: the typed errorMessage BODY renders (not just the "Could not resolve" title).
    expect(screen.getByText(/could not save — try again/i)).toBeInTheDocument();
  });
});

describe('M63 SpanDetail — single enqueue entry-point (T4.2)', () => {
  const span: TraceSpanNode = { spanId: 'sp-1', traceId: 'tr-1', name: 'llm.call', inputValue: 'hi' };

  beforeEach(() => vi.clearAllMocks());

  it('test_span_detail_enqueue_button_posts_once', async () => {
    mockCloudFetch.mockResolvedValue({ id: 'i1', traceId: 'tr-1', spanId: 'sp-1', status: 'pending', createdBy: 'u', createdAt: 'x' });
    render(<SpanDetail span={span} />);
    // exactly ONE enqueue affordance (single entry-point, ADR D5)
    const btns = screen.getAllByRole('button', { name: /add .* to labeling queue/i });
    expect(btns).toHaveLength(1);
    await userEvent.click(btns[0]);
    const enqueueCalls = mockCloudFetch.mock.calls.filter(
      (c) => String(c[0]).includes('/traces/tr-1/enqueue-for-labeling') && (c[1] as { method?: string })?.method === 'POST',
    );
    expect(enqueueCalls).toHaveLength(1);
    expect(JSON.parse((enqueueCalls[0][1] as { body: string }).body)).toEqual({ spanId: 'sp-1' });
    expect(await screen.findByRole('button', { name: /add .* to labeling queue/i })).toHaveTextContent(/queued/i);
  });

  it('test_span_detail_enqueue_error_shows_typed_signal', async () => {
    mockCloudFetch.mockRejectedValue(new Error('403 insufficient scope'));
    render(<SpanDetail span={span} />);
    await userEvent.click(screen.getByRole('button', { name: /add .* to labeling queue/i }));
    expect(await screen.findByTestId('enqueue-error')).toBeInTheDocument();
  });
});
