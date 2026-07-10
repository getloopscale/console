// themory-graph-gateway-dashboard T2.1 acceptance + graph-viz-lib upgrade.
// The view now renders react-force-graph-2d (canvas) instead of inline SVG, so
// node/edge assertions move to (a) a pure unit test of `toGraphData` and (b) a
// mocked ForceGraph2D that records the graphData it receives. The scope-tabs,
// default-scope, empty-state and error-branch assertions are unchanged (those
// are DOM, not canvas).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({
  useRequireAuth: () => ({
    active: true,
    identity: { id: 't', traits: { email: 'u@x.com' } },
  }),
}));

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

// Canvas force-graph is mocked: it surfaces the node/link counts it was handed
// so the view's data wiring is assertable in jsdom (no real canvas).
vi.mock('react-force-graph-2d', () => ({
  default: (props: { graphData: { nodes: unknown[]; links: unknown[] } }) => (
    <div data-testid="force-graph">
      <span data-testid="fg-nodes">{props.graphData.nodes.length}</span>
      <span data-testid="fg-links">{props.graphData.links.length}</span>
    </div>
  ),
}));

// jsdom has no ResizeObserver — the canvas wrapper observes its size.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

import { GraphPage, toGraphData, withHub } from './graph';

describe('toGraphData (pure shaping)', () => {
  it('drops a dangling edge whose endpoint is not a node', () => {
    const { nodes, links } = toGraphData({
      nodes: [{ id: 'John Smith', scope_type: 'user', memory_count: 1 }],
      edges: [{ source: 'John Smith', relation: 'works at', target: 'Ghost', memory_count: 1 }],
    });
    expect(nodes).toHaveLength(1);
    expect(links).toHaveLength(0);
    // the lone node has no surviving link → isolated, group -1
    expect(nodes[0]!.isolated).toBe(true);
    expect(nodes[0]!.group).toBe(-1);
  });

  it('drops a self-loop edge', () => {
    const { links } = toGraphData({
      nodes: [{ id: 'A', scope_type: 'user', memory_count: 1 }],
      edges: [{ source: 'A', relation: 'is', target: 'A', memory_count: 1 }],
    });
    expect(links).toHaveLength(0);
  });

  it('assigns the same cluster group to a connected component', () => {
    const { nodes, links } = toGraphData({
      nodes: [
        { id: 'A', scope_type: 'user', memory_count: 2 },
        { id: 'B', scope_type: 'user', memory_count: 1 },
        { id: 'C', scope_type: 'user', memory_count: 1 }, // isolated
      ],
      edges: [{ source: 'A', relation: 'knows', target: 'B', memory_count: 1 }],
    });
    expect(links).toHaveLength(1);
    const a = nodes.find((n) => n.id === 'A')!;
    const b = nodes.find((n) => n.id === 'B')!;
    const c = nodes.find((n) => n.id === 'C')!;
    expect(a.group).toBe(b.group); // same component
    expect(a.group).toBeGreaterThanOrEqual(0);
    expect(c.isolated).toBe(true);
    expect(c.group).toBe(-1);
  });

  it('folds a single-token alias into its prefix canonical (Acme → Acme Corporation)', () => {
    const { nodes, links } = toGraphData({
      nodes: [
        { id: 'Acme', scope_type: 'user', memory_count: 1 },
        { id: 'Acme Corporation', scope_type: 'user', memory_count: 2 },
        { id: 'DataFlow', scope_type: 'user', memory_count: 1 },
      ],
      edges: [
        { source: 'Acme Corporation', relation: 'acquired', target: 'DataFlow', memory_count: 1 },
        { source: 'Acme', relation: 'located in', target: 'DataFlow', memory_count: 1 },
      ],
    });
    expect(nodes.map((n) => n.id)).not.toContain('Acme'); // folded away
    const corp = nodes.find((n) => n.id === 'Acme Corporation')!;
    expect(corp.memoryCount).toBe(3); // 1 (Acme) + 2 (Acme Corporation) summed
    // the "Acme" edge was redirected to the canonical node — no dangling
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.source !== 'Acme' && l.target !== 'Acme')).toBe(true);
  });

  it('does NOT fold a multi-word substring (São Paulo stays distinct from Universidade de São Paulo)', () => {
    const { nodes } = toGraphData({
      nodes: [
        { id: 'São Paulo', scope_type: 'user', memory_count: 1 },
        { id: 'Universidade de São Paulo', scope_type: 'user', memory_count: 1 },
        { id: 'escritório da Acme', scope_type: 'user', memory_count: 1 },
        { id: 'Acme', scope_type: 'user', memory_count: 1 },
      ],
      edges: [],
    });
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain('São Paulo'); // 2-token → never folds
    expect(ids).toContain('Universidade de São Paulo');
    expect(ids).toContain('Acme'); // "escritório da Acme" does NOT start with "Acme" → no fold
    expect(ids).toContain('escritório da Acme');
  });

  it('withHub adds a synthetic root anchoring the cluster rep + isolated nodes', () => {
    const base = toGraphData({
      nodes: [
        { id: 'A', scope_type: 'user', memory_count: 2 },
        { id: 'B', scope_type: 'user', memory_count: 1 },
        { id: 'Lonely', scope_type: 'user', memory_count: 1 },
      ],
      edges: [{ source: 'A', relation: 'knows', target: 'B', memory_count: 1 }],
    });
    const hubbed = withHub(base, 'You');
    const root = hubbed.nodes.find((n) => n.synthetic);
    expect(root).toBeDefined();
    expect(root!.label).toBe('You');
    const spokes = hubbed.links.filter((l) => l.synthetic);
    const targets = spokes.map((s) => s.target);
    expect(targets).toContain('A'); // cluster representative (higher memory_count)
    expect(targets).toContain('Lonely'); // isolated node anchored
    expect(targets).not.toContain('B'); // not the rep of its cluster
    // real link count unchanged (synthetic spokes are additive, view-only)
    expect(hubbed.links.filter((l) => !l.synthetic)).toHaveLength(1);
  });

  it('withHub is a no-op on an empty graph', () => {
    expect(withHub({ nodes: [], links: [] }, 'You')).toEqual({ nodes: [], links: [] });
  });
});

describe('GraphPage (/memory/graph)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 4 scope tabs (USER / SESSION / AGENT / REPO)', async () => {
    mockCloudFetch.mockResolvedValueOnce({ nodes: [], edges: [] });
    render(<GraphPage />);
    expect(await screen.findByRole('tab', { name: /user/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /session/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /agent/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /repo/i })).toBeInTheDocument();
  });

  it('default active scope is "user" — backend hit with scope=user', async () => {
    mockCloudFetch.mockResolvedValueOnce({ nodes: [], edges: [] });
    render(<GraphPage />);
    expect(await screen.findByRole('tab', { name: /user/i })).toBeInTheDocument();
    expect(mockCloudFetch).toHaveBeenCalledWith(expect.stringContaining('scope=user'));
  });

  it('empty graph renders EmptyState (D5 — no broken canvas)', async () => {
    mockCloudFetch.mockResolvedValueOnce({ nodes: [], edges: [] });
    render(<GraphPage />);
    expect(await screen.findByText(/no graph under/i)).toBeInTheDocument();
  });

  it('hands nodes + links to the force graph when backend returns data', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      nodes: [
        { id: 'John Smith', scope_type: 'user', memory_count: 2 },
        { id: 'Google', scope_type: 'user', memory_count: 1 },
      ],
      edges: [{ source: 'John Smith', relation: 'works at', target: 'Google', memory_count: 1 }],
    });
    render(<GraphPage />);
    expect(await screen.findByTestId('force-graph')).toBeInTheDocument();
    // legend shows the REAL (non-hub) counts
    expect(screen.getByText(/2 entities/i)).toBeInTheDocument();
    expect(screen.getByText(/1 relations/i)).toBeInTheDocument();
  });

  it('a dangling edge is filtered before reaching the force graph (no crash)', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      nodes: [{ id: 'John Smith', scope_type: 'user', memory_count: 1 }],
      edges: [{ source: 'John Smith', relation: 'works at', target: 'Ghost', memory_count: 1 }],
    });
    render(<GraphPage />);
    expect(await screen.findByTestId('force-graph')).toBeInTheDocument();
    // dangling edge dropped → 0 real relations (legend = real, non-hub counts)
    expect(screen.getByText(/1 entities/i)).toBeInTheDocument();
    expect(screen.getByText(/0 relations/i)).toBeInTheDocument();
  });

  it('renders an error Alert when the backend is unreachable (F2)', async () => {
    mockCloudFetch.mockRejectedValueOnce(new Error('network down'));
    render(<GraphPage />);
    expect(await screen.findByText(/could not load the graph/i)).toBeInTheDocument();
  });

  it('non-user scope shows the empty state (D3 — F3)', async () => {
    mockCloudFetch.mockResolvedValueOnce({ nodes: [], edges: [] });
    render(<GraphPage />, { initialEntries: ['/memory/graph?scope=session'] });
    expect(await screen.findByText(/no graph under/i)).toBeInTheDocument();
    expect(mockCloudFetch).toHaveBeenCalledWith(expect.stringContaining('scope=session'));
  });

  it('toggles hiding unconnected (isolated) nodes (#3)', async () => {
    mockCloudFetch.mockResolvedValue({
      nodes: [
        { id: 'A', scope_type: 'user', memory_count: 1 },
        { id: 'B', scope_type: 'user', memory_count: 1 },
        { id: 'Lonely', scope_type: 'user', memory_count: 1 },
      ],
      edges: [{ source: 'A', relation: 'knows', target: 'B', memory_count: 1 }],
    });
    render(<GraphPage />);
    await screen.findByTestId('force-graph');
    expect(screen.getByText(/3 entities/i)).toBeInTheDocument(); // all shown (real counts)
    fireEvent.click(screen.getByRole('button', { name: /hide 1 unconnected/i }));
    expect(screen.getByText(/2 entities/i)).toBeInTheDocument(); // Lonely hidden
  });

  it('toggling "include superseded" refetches with includeSuperseded=true (M1)', async () => {
    mockCloudFetch.mockResolvedValue({
      nodes: [{ id: 'A', scope_type: 'user', memory_count: 1 }],
      edges: [],
    });
    render(<GraphPage />);
    await screen.findByTestId('force-graph');
    // baseline: active-only (no includeSuperseded param)
    expect(mockCloudFetch).toHaveBeenCalledWith(expect.stringContaining('scope=user'));
    expect(mockCloudFetch).not.toHaveBeenCalledWith(expect.stringContaining('includeSuperseded=true'));

    fireEvent.click(screen.getByRole('checkbox', { name: /include superseded edges/i }));

    // after the toggle: the audit-view param is forwarded to the BFF
    await vi.waitFor(() =>
      expect(mockCloudFetch).toHaveBeenCalledWith(expect.stringContaining('includeSuperseded=true')),
    );
  });
});
