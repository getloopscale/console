import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

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
  /** M1 — false when the edge is superseded/invalidated (audit view). */
  active?: boolean;
}

export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * B-057 — the graph REQUEST ceiling.
 *
 * 300 is a choice, not a derivation: it is the value the sibling screen `rag/graphrag.tsx` uses,
 * and it is NOT read off a render limit (there is none — the label budget caps labels, not nodes).
 * A force graph past this size stops being legible before it stops being renderable. If measurement
 * shows 300 cuts useful graphs, the number changes; what does not come back is the absence of a
 * ceiling.
 */
const GRAPH_REQUEST_CAP = 300;

/**
 * The memory relation graph for one scope.
 *
 * `throwOnError` so a failed fetch is `isError` rather than an empty graph rendered as "no
 * relations" (theo-cloud#250) — the reading that matters here, because an empty graph and an
 * unreachable service look identical on a canvas.
 */
export function useMemoryGraph(filters: {
  scope: string;
  session: string;
  includeSuperseded: boolean;
}) {
  const { scope, session, includeSuperseded } = filters;

  return useQuery({
    queryKey: [
      'cloud',
      '/v1/dashboard/memory/graph',
      { activeScope: scope, session, includeSuperseded },
    ] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('scope', scope);
      params.set('limit', String(GRAPH_REQUEST_CAP));
      if (scope === 'session' && session) params.set('session_id', session);
      if (includeSuperseded) params.set('includeSuperseded', 'true');

      return cloudFetch<GraphResult>(
        `/v1/dashboard/memory/graph?${params.toString()}`,
        {},
        { throwOnError: true },
      );
    },
  });
}
