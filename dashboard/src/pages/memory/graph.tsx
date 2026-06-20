import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Share2 } from 'lucide-react';
import { Alert, Card, EmptyState, PageShell, Tabs } from '@usetheo/ui';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * themory-graph-gateway-dashboard — /memory/graph.
 *
 * Entity relation graph ({nodes, edges}) rendered as a dependency-free SVG
 * node-link diagram (ADR D1 — no cytoscape/react-flow). Mirrors entities.tsx:
 *  - 4 scope tabs (USER / SESSION / AGENT / REPO) via `useSearchParams('scope')`
 *  - react-query against the BFF `/v1/dashboard/memory/graph?scope=`
 *  - EmptyState when the active scope has no nodes (D5 — never null/NaN)
 */
interface GraphNode {
  id: string;
  scope_type: string;
  memory_count: number;
  last_seen_at?: string;
}
interface GraphEdge {
  source: string;
  relation: string;
  target: string;
  memory_count: number;
}
interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const SCOPES = ['user', 'session', 'agent', 'repo'] as const;
type Scope = (typeof SCOPES)[number];

const SIZE = 560;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 90;

/** Deterministic circular layout: node i at angle 2πi/n. */
function layout(nodes: GraphNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const n = Math.max(nodes.length, 1);
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    positions.set(node.id, {
      x: CENTER + RADIUS * Math.cos(angle),
      y: CENTER + RADIUS * Math.sin(angle),
    });
  });
  return positions;
}

function GraphSvg({ nodes, edges }: GraphResult) {
  const pos = layout(nodes);
  // Only render edges whose BOTH endpoints are present as nodes (defensive — a
  // dangling endpoint never produces NaN coords).
  const drawableEdges = edges.filter((e) => pos.has(e.source) && pos.has(e.target));
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="w-full h-auto max-h-[70vh]"
      role="img"
      aria-label="Entity relation graph"
      data-testid="graph-svg"
    >
      {drawableEdges.map((e, i) => {
        const a = pos.get(e.source)!;
        const b = pos.get(e.target)!;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g key={`edge-${String(i)}`} data-testid="graph-edge">
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="stroke-muted-foreground/40"
              strokeWidth={1.5}
            />
            <text
              x={mx}
              y={my}
              dy={-4}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {e.relation}
            </text>
          </g>
        );
      })}
      {nodes.map((node) => {
        const p = pos.get(node.id)!;
        const r = 6 + Math.min(node.memory_count, 8);
        return (
          <g key={`node-${node.id}`} data-testid="graph-node">
            <circle cx={p.x} cy={p.y} r={r} className="fill-primary/70 stroke-primary" strokeWidth={1.5} />
            <text x={p.x} y={p.y} dy={r + 14} textAnchor="middle" className="fill-foreground text-xs font-medium">
              {node.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function GraphPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Graph'), [setPageTitle]);
  useRequireAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const scopeParam = searchParams.get('scope');
  const activeScope: Scope = SCOPES.includes(scopeParam as Scope) ? (scopeParam as Scope) : 'user';

  const setScope = (next: Scope) => {
    const params = new URLSearchParams(searchParams);
    params.set('scope', next);
    setSearchParams(params, { replace: true });
  };

  const query = useQuery({
    queryKey: ['cloud', '/v1/dashboard/memory/graph', activeScope] as const,
    queryFn: () => cloudFetch<GraphResult>(`/v1/dashboard/memory/graph?scope=${activeScope}`),
  });

  const nodes = query.data?.nodes ?? [];
  const edges = query.data?.edges ?? [];

  return (
    <PageShell
      title="Graph"
      description="How the entities your agent remembers relate to each other — a node-link view of the relation graph."
    >
      <div className="space-y-6">
        <Tabs value={activeScope} onValueChange={(v) => setScope(v as Scope)}>
          <Tabs.List>
            <Tabs.Trigger value="user">USER</Tabs.Trigger>
            <Tabs.Trigger value="session">SESSION</Tabs.Trigger>
            <Tabs.Trigger value="agent">AGENT</Tabs.Trigger>
            <Tabs.Trigger value="repo">REPO</Tabs.Trigger>
          </Tabs.List>
        </Tabs>

        {query.isError ? (
          <Alert intent="warning" title="Could not load the graph">
            The Memory service is not reachable right now. Try refreshing in a moment.
          </Alert>
        ) : query.isLoading ? (
          <Card>Loading…</Card>
        ) : nodes.length === 0 ? (
          <EmptyState
            icon={Share2}
            title={`No graph under ${activeScope}`}
            description="Once your agent remembers facts with relations between entities, they appear here as a graph."
          />
        ) : (
          <Card className="p-4">
            <GraphSvg nodes={nodes} edges={edges} />
          </Card>
        )}
      </div>
    </PageShell>
  );
}
