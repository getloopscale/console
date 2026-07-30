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

import { GraphPage, toGraphData, withHub, defaultShowIsolated, topLabelIds } from './graph';

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

  it('marks a superseded edge (active:false) so the audit view can dim it (M1)', () => {
    const { links } = toGraphData({
      nodes: [
        { id: 'Kendra', scope_type: 'user', memory_count: 1 },
        { id: 'Adidas', scope_type: 'user', memory_count: 1 },
        { id: 'Nike', scope_type: 'user', memory_count: 1 },
      ],
      edges: [
        { source: 'Kendra', relation: 'loves', target: 'Adidas', memory_count: 1, active: false },
        { source: 'Kendra', relation: 'loves', target: 'Nike', memory_count: 1, active: true },
      ],
    });
    expect(links.find((l) => l.target === 'Adidas')?.superseded).toBe(true);
    expect(links.find((l) => l.target === 'Nike')?.superseded).toBe(false);
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
    expect(mockCloudFetch).toHaveBeenCalledWith(expect.stringContaining('scope=user'), expect.anything(), expect.objectContaining({ throwOnError: true }));
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
    // Routed by URL, not `mockResolvedValueOnce`. The session scope also renders <SessionPicker/>,
    // which issues its OWN cloudFetch — so the single queued "Once" was consumed by whichever query
    // fired first, and the graph query got `undefined`. React Query rejects a queryFn that does not
    // return a promise, so the page rendered the error Alert and this test had been RED in develop.
    // It went unnoticed because no workflow runs the dashboard suite at all (see theo-cloud#276).
    mockCloudFetch.mockImplementation((url: string) =>
      Promise.resolve(url.includes('/sessions') ? { sessions: [] } : { nodes: [], edges: [] }),
    );
    render(<GraphPage />, { initialEntries: ['/memory/graph?scope=session'] });
    expect(await screen.findByText(/no graph under/i)).toBeInTheDocument();
    expect(mockCloudFetch).toHaveBeenCalledWith(expect.stringContaining('scope=session'), expect.anything(), expect.objectContaining({ throwOnError: true }));
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
    expect(mockCloudFetch).toHaveBeenCalledWith(expect.stringContaining('scope=user'), expect.anything(), expect.objectContaining({ throwOnError: true }));
    expect(mockCloudFetch).not.toHaveBeenCalledWith(expect.stringContaining('includeSuperseded=true'), expect.anything(), expect.anything());

    fireEvent.click(screen.getByRole('checkbox', { name: /include superseded edges/i }));

    // after the toggle: the audit-view param is forwarded to the BFF
    await vi.waitFor(() =>
      expect(mockCloudFetch).toHaveBeenCalledWith(expect.stringContaining('includeSuperseded=true'), expect.anything(), expect.objectContaining({ throwOnError: true })),
    );
  });
});

/**
 * theo-cloud#254 — the Graph tab was an illegible hairball in its DEFAULT state: 4423 nodes and
 * 2954 relations, 1266 of them (29%) unconnected, every connected node labelled unconditionally.
 *
 * Both mitigations already EXISTED as buttons; neither was on. The complaint is not that the screen
 * cannot be made readable — it is that the operator has to discover how. A default that requires
 * discovery is not a default.
 */
describe('#254 — the Graph is legible in its default state', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('defaultShowIsolated', () => {
    it('hides unconnected nodes once the graph is big enough to be a hairball', () => {
      expect(defaultShowIsolated(4423, 1266)).toBe(false);
    });

    it('keeps a small graph whole — showing everything is legible there', () => {
      // Graceful degradation, the issue's own framing: "bases pequenas continuam com o grafo completo".
      expect(defaultShowIsolated(40, 12)).toBe(true);
    });

    it('never hides when hiding would blank the canvas', () => {
      // Every node unconnected: hiding leaves NOTHING. An empty graph over a populated workspace is a
      // worse lie than a crowded one — it reads as "you have no entities".
      expect(defaultShowIsolated(4423, 4423)).toBe(true);
    });

    it('is a no-op when there is nothing unconnected to hide', () => {
      expect(defaultShowIsolated(4423, 0)).toBe(true);
    });
  });

  describe('topLabelIds', () => {
    const node = (id: string) => ({ id, memoryCount: 1, group: 0, isolated: false });

    it('labels every node while they still fit', () => {
      const data = { nodes: [node('A'), node('B')], links: [{ source: 'A', target: 'B', relation: 'r' }] };
      expect(topLabelIds(data, 40)).toEqual(new Set(['A', 'B']));
    });

    it('past the limit, keeps the most-CONNECTED nodes', () => {
      // Degree, not memoryCount: this screen is about relations, so the nodes worth naming are the
      // ones the graph converges on. A hub with 30 edges must keep its label; a leaf need not.
      const nodes = ['hub', 'a', 'b', 'c'].map(node);
      const links = [
        { source: 'hub', target: 'a', relation: 'r' },
        { source: 'hub', target: 'b', relation: 'r' },
        { source: 'a', target: 'b', relation: 'r' },
        { source: 'c', target: 'c', relation: 'r' },
      ];
      const kept = topLabelIds({ nodes, links }, 2);
      expect(kept.size).toBe(2);
      expect(kept.has('hub')).toBe(true);
    });

    it('reads endpoints that the force simulation already replaced with node objects', () => {
      // react-force-graph MUTATES links in place, swapping the id string for the node object. A
      // degree count that assumed strings would silently see degree 0 for every node — and then
      // label nothing at all.
      const nodes = [node('A'), node('B')];
      const links = [{ source: { id: 'A' }, target: { id: 'B' }, relation: 'r' }] as unknown as Parameters<typeof topLabelIds>[0]['links'];
      expect(topLabelIds({ nodes, links }, 1).size).toBe(1);
    });
  });

  it('a large graph hands the canvas only the connected nodes, and says so', async () => {
    // 600 nodes, 200 of them unconnected — over the hairball threshold.
    const connected = Array.from({ length: 400 }, (_, i) => ({ id: `c${String(i)}`, scope_type: 'user', memory_count: 1 }));
    const isolated = Array.from({ length: 200 }, (_, i) => ({ id: `i${String(i)}`, scope_type: 'user', memory_count: 1 }));
    const edges = connected.slice(0, 399).map((n, i) => ({ source: n.id, target: `c${String(i + 1)}`, relation: 'r' }));
    mockCloudFetch.mockResolvedValue({ nodes: [...connected, ...isolated], edges });

    render(<GraphPage />);
    await screen.findByTestId('force-graph');

    // 400 connected + 1 synthetic hub root (hub view is on by default).
    expect(Number(screen.getByTestId('fg-nodes').textContent)).toBe(401);
    // Honest and reversible: the button states what is hidden and offers it back.
    expect(screen.getByRole('button', { name: /show 200 unconnected/i })).toBeInTheDocument();
  });

  it('a small graph is still handed whole', async () => {
    mockCloudFetch.mockResolvedValue({
      nodes: [
        { id: 'A', scope_type: 'user', memory_count: 1 },
        { id: 'B', scope_type: 'user', memory_count: 1 },
        { id: 'lonely', scope_type: 'user', memory_count: 1 },
      ],
      edges: [{ source: 'A', target: 'B', relation: 'r' }],
    });
    render(<GraphPage />);
    await screen.findByTestId('force-graph');
    // 3 real + 1 hub — nothing hidden.
    expect(Number(screen.getByTestId('fg-nodes').textContent)).toBe(4);
    expect(screen.getByRole('button', { name: /hide 1 unconnected/i })).toBeInTheDocument();
  });
});
