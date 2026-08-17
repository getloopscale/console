import { useQuery } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  degree: number;
  community_key: string | null;
}

interface GraphLink {
  source: string;
  target: string;
  weight: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphLink[];
}

interface Community {
  community_key: string;
  level: number;
  size: number;
  summary: string | null;
  member_names: string[];
}

interface ReportFinding {
  summary?: string;
  explanation?: string;
}

interface CommunityReport {
  community_key: string;
  title: string;
  summary: string;
  full_content: string;
  findings: ReportFinding[];
}

/**
 * The graph REQUEST ceiling — the same 300 the sibling screen `memory/graph.tsx` uses, and for the
 * same reason: a force graph past this size stops being legible before it stops being renderable.
 */
const GRAPH_REQUEST_CAP = 300;

function collectionPath(collectionID: string): string {
  return `/v1/dashboard/rag/collections/${encodeURIComponent(collectionID)}`;
}

/**
 * The three GraphRAG reads (M10/M13), which share a collection, a level, and an `enabled` gate.
 *
 * Keeping them together is what keeps the LEVEL honest. All three are scoped to the same level and
 * all three carry it in their key; a level added to one URL and forgotten in one key would render a
 * community's report from one level beside a graph from another, and nothing on screen would say
 * the two disagree. The BFF forwards theo-rag's JSON opaquely — this layer types it and nothing
 * more.
 */
export function useRagGraph(collectionID: string, level: string) {
  return useQuery({
    enabled: collectionID !== '',
    queryKey: ['cloud', 'rag-graph', collectionID, level] as const,
    queryFn: () =>
      cloudFetch<GraphData>(
        `${collectionPath(collectionID)}/graph?level=${level}&limit=${GRAPH_REQUEST_CAP}`,
        {},
        { throwOnError: true },
      ),
  });
}

export function useRagCommunities(collectionID: string, level: string) {
  return useQuery({
    enabled: collectionID !== '',
    queryKey: ['cloud', 'rag-communities', collectionID, level] as const,
    queryFn: () =>
      cloudFetch<{ communities: Community[] }>(
        `${collectionPath(collectionID)}/communities?level=${level}`,
        {},
        { throwOnError: true },
      ),
  });
}

/** M13 — the full report for the open community (drill-down): title + full_content + findings. */
export function useCommunityReport(collectionID: string, reportKey: string | null, level: string) {
  return useQuery({
    enabled: collectionID !== '' && reportKey !== null,
    queryKey: ['cloud', 'rag-community-report', collectionID, reportKey, level] as const,
    queryFn: () =>
      cloudFetch<CommunityReport>(
        `${collectionPath(collectionID)}/communities/${encodeURIComponent(reportKey ?? '')}/report?level=${level}`,
        {},
        { throwOnError: true },
      ),
  });
}
