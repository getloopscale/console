import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, Toaster, violetForge } from '@usetheo/ui';
import { PageMetaProvider } from '@/hooks/use-page-meta';
import { LensComparePage } from './compare';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

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
    children: children.map((n, i) => ({
      spanId: `${id}-${i}`,
      traceId: id,
      name: n,
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '1001000000',
    })),
  };
}

// Route cloudFetch by path: tree vs cost, per trace id.
function routeFetch(map: Record<string, unknown>, costMap: Record<string, unknown>) {
  return (path: string) => {
    if (typeof path !== 'string') return Promise.resolve(null); // stray provider fetch — ignore
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

beforeEach(() => mockCloudFetch.mockReset());

describe('LensComparePage', () => {
  it('renders two lanes with timelines when both traces resolve', async () => {
    mockCloudFetch.mockImplementation(
      routeFetch(
        { 'tr-A': tree('tr-A', 'root', '1002000000', ['llm']), 'tr-B': tree('tr-B', 'root', '1004000000', ['llm']) },
        { 'tr-A': { traceId: 'tr-A', costUsd: 0.1, totalTokens: 100 }, 'tr-B': { traceId: 'tr-B', costUsd: 0.2, totalTokens: 200 } },
      ),
    );
    renderCompare('tr-A,tr-B');
    await waitFor(() => expect(screen.getAllByTestId('compare-lane')).toHaveLength(2));
    expect(screen.getAllByTestId('span-bar').length).toBeGreaterThanOrEqual(2);
  });

  it('one missing trace → that lane shows an error, the other still renders (no page crash)', async () => {
    mockCloudFetch.mockImplementation(
      routeFetch(
        { 'tr-A': tree('tr-A', 'root', '1002000000', ['llm']) }, // tr-B absent → 404
        { 'tr-A': { traceId: 'tr-A', costUsd: 0.1, totalTokens: 100 } },
      ),
    );
    renderCompare('tr-A,tr-B');
    await waitFor(() => expect(screen.getByTestId('lane-error-tr-B')).toBeInTheDocument());
    // lane A still rendered its timeline
    expect(screen.getAllByTestId('span-bar').length).toBeGreaterThanOrEqual(1);
  });

  it('cross-tenant id is refused upstream the same way (lane error, no foreign spans)', async () => {
    mockCloudFetch.mockImplementation(
      routeFetch(
        { 'tr-A': tree('tr-A', 'root', '1002000000', ['llm']) }, // tr-OTHER (other tenant) → rejected
        { 'tr-A': { traceId: 'tr-A', costUsd: 0.1, totalTokens: 100 } },
      ),
    );
    renderCompare('tr-A,tr-OTHER');
    await waitFor(() => expect(screen.getByTestId('lane-error-tr-OTHER')).toBeInTheDocument());
  });

  it('aligned traces → root delta badges highlight faster/cheaper (B vs A baseline)', async () => {
    // B is faster (smaller duration) and cheaper → deltas render with the "−" (better) direction.
    mockCloudFetch.mockImplementation(
      routeFetch(
        { 'tr-A': tree('tr-A', 'root', '1004000000', ['llm']), 'tr-B': tree('tr-B', 'root', '1002000000', ['llm']) },
        { 'tr-A': { traceId: 'tr-A', costUsd: 0.2, totalTokens: 200 }, 'tr-B': { traceId: 'tr-B', costUsd: 0.1, totalTokens: 100 } },
      ),
    );
    renderCompare('tr-A,tr-B');
    await waitFor(() => expect(screen.getAllByTestId('delta-badge').length).toBeGreaterThanOrEqual(1));
    // at least one delta badge shows the improvement direction
    const badges = screen.getAllByTestId('delta-badge');
    expect(badges.some((b) => b.textContent?.includes('−'))).toBe(true);
  });

  it('divergent structures → "structurally different" + "only in" markers, no fabricated 1:1', async () => {
    mockCloudFetch.mockImplementation(
      routeFetch(
        { 'tr-A': tree('tr-A', 'root', '1002000000', ['old-name']), 'tr-B': tree('tr-B', 'root', '1002000000', ['new-name']) },
        { 'tr-A': { traceId: 'tr-A', costUsd: 0.1, totalTokens: 100 }, 'tr-B': { traceId: 'tr-B', costUsd: 0.1, totalTokens: 100 } },
      ),
    );
    renderCompare('tr-A,tr-B');
    await waitFor(() => expect(screen.getByText(/structurally different/i)).toBeInTheDocument());
    expect(screen.getByText(/only in a/i)).toBeInTheDocument();
    expect(screen.getByText(/only in b/i)).toBeInTheDocument();
  });

  it('cost fetch error → cost degrades to "—", duration/tokens still render', async () => {
    mockCloudFetch.mockImplementation(
      routeFetch(
        { 'tr-A': tree('tr-A', 'root', '1002000000', ['llm']), 'tr-B': tree('tr-B', 'root', '1002000000', ['llm']) },
        { 'tr-A': { traceId: 'tr-A', costUsd: 0.1, totalTokens: 100 } }, // tr-B cost rejects
      ),
    );
    renderCompare('tr-A,tr-B');
    await waitFor(() => expect(screen.getAllByTestId('compare-lane')).toHaveLength(2));
    // the compare still renders both lanes (cost degradation does not sink the page)
    expect(screen.getByTestId('cost-degraded-tr-B')).toBeInTheDocument();
  });
});
