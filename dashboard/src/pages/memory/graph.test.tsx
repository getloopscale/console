// themory-graph-gateway-dashboard T2.1 acceptance.
// Focused on: 4 scope tabs + default scope=user + empty state + SVG nodes/edges render.

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { GraphPage } from './graph';

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

  it('empty graph renders EmptyState (D5 — no broken SVG)', async () => {
    mockCloudFetch.mockResolvedValueOnce({ nodes: [], edges: [] });
    render(<GraphPage />);
    expect(await screen.findByText(/no graph under/i)).toBeInTheDocument();
  });

  it('renders nodes + edges as SVG when backend returns data', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      nodes: [
        { id: 'John Smith', scope_type: 'user', memory_count: 2 },
        { id: 'Google', scope_type: 'user', memory_count: 1 },
      ],
      edges: [{ source: 'John Smith', relation: 'works at', target: 'Google', memory_count: 1 }],
    });
    render(<GraphPage />);
    // Nodes render (label text)
    expect(await screen.findByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    // Edge renders with its relation label
    expect(screen.getByText('works at')).toBeInTheDocument();
    // At least one SVG edge element
    expect(screen.getAllByTestId('graph-edge').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('graph-node').length).toBe(2);
  });

  it('skips an edge whose endpoint is not in nodes (no crash)', async () => {
    mockCloudFetch.mockResolvedValueOnce({
      nodes: [{ id: 'John Smith', scope_type: 'user', memory_count: 1 }],
      edges: [{ source: 'John Smith', relation: 'works at', target: 'Ghost', memory_count: 1 }],
    });
    render(<GraphPage />);
    expect(await screen.findByText('John Smith')).toBeInTheDocument();
    // The dangling edge is skipped (target 'Ghost' not a node) → zero edges drawn.
    expect(screen.queryAllByTestId('graph-edge').length).toBe(0);
  });
});
