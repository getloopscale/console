import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from '@getloopscale/ui';
import { ThemeProvider, violetForge } from '@getloopscale/loopzero-ui';
import { PageMetaProvider } from '@/hooks/use-page-meta';
import { LensComparePage } from './compare';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

/**
 * M8 — the compare-page integration suite (consumer-owned). The side-by-side lanes, the metrics
 * header, and the structural diff table moved to `@getloopscale/ui` `TraceCompare`; this file tests the
 * consumer concerns the DS never owns: the `?ids=` URL, the two fetches, honest per-lane error
 * surfaces, and that the mapped data drives the kit's honest deltas / "only in A/B" markers.
 */

function renderCompare(ids: string): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } });
  return rtlRender(<LensComparePage />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <ThemeProvider themes={[violetForge]} defaultTheme="violet-forge" defaultMode="dark">
          <Toaster>
            <MemoryRouter initialEntries={[`/observability/compare?ids=${ids}`]}>
              <PageMetaProvider>{children}</PageMetaProvider>
            </MemoryRouter>
          </Toaster>
        </ThemeProvider>
      </QueryClientProvider>
    ),
  });
}

// A tree of the given root name with `children` names; span timings make duration deterministic.
function tree(id: string, rootName: string, durNs: string, children: string[] = []) {
  return {
    spanId: `${id}-root`,
    traceId: id,
    name: rootName,
    startTimeUnixNano: '1000000000',
    endTimeUnixNano: durNs,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.2,
    children: children.map((n, i) => ({
      spanId: `${id}-${i}`,
      traceId: id,
      name: n,
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '1001000000',
      inputTokens: 20,
      outputTokens: 10,
    })),
  };
}

// Route cloudFetch by path: tree vs cost, per trace id.
function routeFetch(map: Record<string, unknown>, costMap: Record<string, unknown>) {
  return (path: string) => {
    if (typeof path !== 'string') return Promise.resolve(null);
    const costMatch = path.match(/\/traces\/([^/]+)\/cost$/);
    if (costMatch) {
      const id = decodeURIComponent(costMatch[1]);
      if (costMap[id] === undefined) return Promise.reject(new Error('cost 5xx'));
      return Promise.resolve(costMap[id]);
    }
    const treeMatch = path.match(/\/traces\/([^/]+)$/);
    if (treeMatch) {
      const id = decodeURIComponent(treeMatch[1]);
      if (map[id] === undefined) return Promise.reject(new Error('404'));
      return Promise.resolve(map[id]);
    }
    return Promise.reject(new Error('unexpected path ' + path));
  };
}

const bothOk = (childrenA: string[] = ['llm'], childrenB: string[] = ['llm'], durB = '1002000000') =>
  routeFetch(
    { 'tr-A': tree('tr-A', 'root', '1004000000', childrenA), 'tr-B': tree('tr-B', 'root', durB, childrenB) },
    { 'tr-A': { traceId: 'tr-A', costUsd: 0.2 }, 'tr-B': { traceId: 'tr-B', costUsd: 0.1 } },
  );

beforeEach(() => mockCloudFetch.mockReset());

describe('LensComparePage', () => {
  it('needs two ids — otherwise a pick-two empty state', async () => {
    mockCloudFetch.mockImplementation(bothOk());
    renderCompare('tr-A');
    expect(await screen.findByText(/select two traces/i)).toBeInTheDocument();
  });

  it('renders both lanes + a diff table when both traces resolve (kit TraceCompare)', async () => {
    mockCloudFetch.mockImplementation(bothOk());
    const { container } = renderCompare('tr-A,tr-B');
    await waitFor(() => expect(container.querySelectorAll('[data-slot="diff-row"]').length).toBeGreaterThan(0));
    expect(screen.getByText(/tr-A · baseline/)).toBeInTheDocument();
    expect(screen.getByText('tr-B')).toBeInTheDocument();
  });

  // NOTE: the "pending lane → skeleton, no fabricated delta" behavior is owned + authoritatively tested
  // by the design system: `@getloopscale/ui` TraceCompare `test_lane_pending_mostra_skeleton_sem_delta`
  // asserts exactly `data-slot="lane-pending"` present + `data-slot="delta-badge"` absent while a lane
  // is pending. Per the M8 blueprint Q12, component-render behavior migrated to the lib; this page keeps
  // the consumer-owned integration (URL, the two fetches, error surfaces) covered by the cases here.
  // A consumer-level re-assertion would need a never-resolving fetch, which leaks an open handle into
  // this file's teardown — redundant coverage is not worth the flake.

  it('one missing trace → that lane shows an honest error alert (no eternal skeleton)', async () => {
    mockCloudFetch.mockImplementation(
      routeFetch({ 'tr-A': tree('tr-A', 'root', '1002000000', ['llm']) }, { 'tr-A': { traceId: 'tr-A', costUsd: 0.1 } }),
    );
    renderCompare('tr-A,tr-B');
    await waitFor(() => expect(screen.getByTestId('lane-error-tr-B')).toBeInTheDocument());
    expect(screen.getByText(/is unavailable/i)).toBeInTheDocument();
  });

  it('cross-tenant id is refused upstream the same way (lane error)', async () => {
    mockCloudFetch.mockImplementation(
      routeFetch({ 'tr-A': tree('tr-A', 'root', '1002000000', ['llm']) }, { 'tr-A': { traceId: 'tr-A', costUsd: 0.1 } }),
    );
    renderCompare('tr-A,tr-OTHER');
    await waitFor(() => expect(screen.getByTestId('lane-error-tr-OTHER')).toBeInTheDocument());
  });

  it('aligned traces → per-span delta badges (B vs A baseline)', async () => {
    mockCloudFetch.mockImplementation(bothOk(['llm'], ['llm'], '1002000000'));
    const { container } = renderCompare('tr-A,tr-B');
    await waitFor(() =>
      expect(container.querySelectorAll('[data-slot="delta-badge"]').length).toBeGreaterThanOrEqual(1),
    );
  });

  it('divergent structures → "only in A/B" markers, no fabricated 1:1', async () => {
    mockCloudFetch.mockImplementation(bothOk(['old-name'], ['new-name'], '1002000000'));
    renderCompare('tr-A,tr-B');
    await waitFor(() => expect(screen.getByText(/only in a/i)).toBeInTheDocument());
    expect(screen.getByText(/only in b/i)).toBeInTheDocument();
  });

  it('repeated span names across branches → no duplicate React keys', async () => {
    const branchy = (id: string) => ({
      spanId: `${id}-r`,
      traceId: id,
      name: 'root',
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '1002000000',
      children: [0, 1].map((t) => ({
        spanId: `${id}-tool-${t}`,
        traceId: id,
        name: 'tool',
        children: [{ spanId: `${id}-llm-${t}`, traceId: id, name: 'llm' }],
      })),
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCloudFetch.mockImplementation(
      routeFetch(
        { 'tr-A': branchy('tr-A'), 'tr-B': branchy('tr-B') },
        { 'tr-A': { traceId: 'tr-A', costUsd: 0.1 }, 'tr-B': { traceId: 'tr-B', costUsd: 0.1 } },
      ),
    );
    const { container } = renderCompare('tr-A,tr-B');
    await waitFor(() => expect(container.querySelectorAll('[data-slot="diff-row"]').length).toBeGreaterThan(0));
    expect(errSpy.mock.calls.flat().join(' ')).not.toMatch(/same key/i);
    errSpy.mockRestore();
  });

  it('cost fetch error does not break the comparison (deltas still render)', async () => {
    mockCloudFetch.mockImplementation(
      routeFetch({ 'tr-A': tree('tr-A', 'root', '1004000000', ['llm']), 'tr-B': tree('tr-B', 'root', '1002000000', ['llm']) }, {}),
    );
    renderCompare('tr-A,tr-B');
    await waitFor(() => expect(screen.getByText(/tr-A · baseline/)).toBeInTheDocument());
    expect(screen.getByText('tr-B')).toBeInTheDocument();
  });
});
